import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {mkdir, lstat, chmod} from 'node:fs/promises';
import path from 'node:path';
import {setImmediate as yieldToCallbacks} from 'node:timers/promises';
import {filerReadBudget, FILER_READ_CHUNK_SIZE, assertReadRange} from '@refinio/filer.core/reads';

const require = createRequire(import.meta.url);
const NativeProvider = require('./build/Release/ifsprojfs.node').IFSProjFSProvider;

/** Validate virtual paths without stripping mount names or permitting ADS/traversal. */
function canonical(value) {
    if (value === 'root' || value === '/') return '/';
    if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\') ||
        value.slice(1).split('/').some(part => !part || part === '.' || part === '..' || part.endsWith('.') ||
            part.endsWith(' ') || /[\x00-\x1f:<>"|?*]/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
        throw Object.assign(new Error('Invalid virtual path'), {code: -22});
    }
    return value;
}

/** Translate owner errors into Windows errors; unknown failures remain I/O errors. */
function windowsError(error) {
    if (error?.name === 'AbortError') return 995;
    if (error?.hresult) return error.hresult & 0xffff;
    const codes = new Map([[-2, 2], ['ENOENT', 2], ['FSE-ENOENT', 2], [-13, 5],
        ['EACCES', 5], [-30, 5], [-17, 183], [-22, 87], [-16, 170]]);
    return codes.get(error?.code) ?? 1117;
}

/** Windows projection of the canonical runtime filesystem. */
export class IFSProjFSProvider extends EventEmitter {
    constructor(options) {
        super();
        if (!options?.fileSystem) throw new Error('fileSystem is required');
        this.fileSystem = options.fileSystem;
        this.virtualRoot = path.resolve(options.virtualRoot);
        this.importLocal = options.importLocal;
        this.provider = new NativeProvider();
        this.requests = new Map();
        this.work = new Set();
        this.imports = new Map();
        this.imported = new Set();
        this.closing = false;
    }

    /** Normalize owner metadata without fabricating timestamps or content versions. */
    async getFileInfo(value) {
        return this.describe(await this.resolvePath(value));
    }

    /** Resolve Windows spelling with ProjFS's comparison, preserving the owner's actual name. */
    async resolvePath(value) {
        const target = canonical(value);
        let directory = '/';
        if (target === '/') return directory;
        for (const component of target.slice(1).split('/')) {
            const {children} = await this.fileSystem.readDir(directory);
            const names = children.filter(name => this.provider.compareNames(name, component) === 0);
            if (!names.length) throw Object.assign(new Error('File does not exist'), {code: -2});
            if (names.length !== 1) throw new Error('Directory contains colliding Windows filenames');
            canonical('/' + names[0]);
            directory = path.posix.join(directory, names[0]);
        }
        return directory;
    }

    /** Read metadata at an already resolved owner path. */
    async describe(target) {
        const info = await this.fileSystem.stat(target);
        if (!Number.isSafeInteger(info.size) || info.size < 0) throw new Error('Invalid file size');
        return {path: target, name: path.posix.basename(target), size: info.size,
            isDirectory: (info.mode & 0o170000) === 0o40000,
            contentVersion: info.item?.contentVersion ?? info.contentHash ?? '',
            metadataVersion: info.item?.metadataVersion ?? info.metadataHash ?? ''};
    }

    /** Enumerate metadata sequentially, avoiding unbounded stat fanout. */
    async readDirectory(value) {
        const target = await this.resolvePath(value);
        const {children} = await this.fileSystem.readDir(target);
        const entries = [];
        const sorted = [...children].sort(this.provider.compareNames.bind(this.provider));
        let previous;
        for (const name of sorted) {
            if (typeof name !== 'string' || name.includes('/') || name.endsWith('.') || name.endsWith(' ')) {
                throw new Error('Directory contains a nonportable filename');
            }
            if (previous !== undefined && this.provider.compareNames(previous, name) === 0) throw new Error('Directory contains colliding Windows filenames');
            previous = name;
            canonical('/' + name);
            entries.push(await this.describe(path.posix.join(target, name)));
        }
        return entries;
    }

    /** Serve each OS request in bounded ranges; hold admission through the native copy. */
    async readRequest(request, signal) {
        assertReadRange(request.position, request.length);
        const info = await this.getFileInfo(request.path);
        const ownerPath = info.path;
        if (request.contentVersion !== info.contentVersion) throw new Error('Placeholder content version is no longer current');
        const end = Math.min(info.size, request.position + request.length);
        for (let position = request.position; position < end;) {
            const length = Math.min(FILER_READ_CHUNK_SIZE, end - position);
            await filerReadBudget.consume(this.fileSystem, ownerPath, position, length, async bytes => {
                if (bytes.byteLength !== length) throw new Error('Unexpected EOF during hydration');
                if ((await this.describe(ownerPath)).contentVersion !== info.contentVersion) throw new Error('File changed during hydration');
                if (!this.provider.writeData(request.id, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), position)) {
                    throw new DOMException('Read was cancelled', 'AbortError');
                }
            }, signal);
            position += length;
            // Owner cache hits may resolve synchronously for thousands of chunks.
            // Yield to native cancellation/shutdown callbacks without a timed delay.
            await yieldToCallbacks();
        }
    }

    /** Commit local imports in notification order so parent directories precede children. */
    async importRequest(request) {
        const target = canonical(request.path);
        if (this.imported.has(target)) return;
        if (!this.importLocal) throw new Error('This mount has no file import owner');
        if (this.imports.has(target)) return this.imports.get(target);
        const parent = this.imports.get(path.posix.dirname(target));
        const operation = (async () => {
            await parent;
            const localPath = path.join(this.virtualRoot, ...target.slice(1).split('/'));
            let ancestor = this.virtualRoot;
            for (const component of target.slice(1).split('/')) {
                ancestor = path.join(ancestor, component);
                if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('Cannot import through a reparse point');
            }
            const local = await lstat(localPath);
            if (local.isSymbolicLink()) throw new Error('Cannot import a reparse point');
            await this.importLocal(target, localPath, request.isDirectory);
            if (!request.isDirectory) await chmod(localPath, 0o444);
            this.imported.add(target);
            this.emit('imported', target);
        })();
        this.imports.set(target, operation);
        try { await operation; } finally { this.imports.delete(target); }
    }

    /** Native callback entry; every promise is tracked and every command is completed. */
    dispatch(request) {
        if (process.env.ONE_PROJFS_DEBUG) console.error('[ProjFS]', request);
        if (request.operation === 'cancel') {
            this.requests.get(request.id)?.abort();
            return;
        }
        const controller = new AbortController();
        if (this.closing) controller.abort();
        if (request.id !== undefined) this.requests.set(request.id, controller);
        const operation = (async () => {
            try {
                controller.signal.throwIfAborted();
                let result;
                switch (request.operation) {
                    case 'list': result = await this.readDirectory(request.path); break;
                    case 'query': case 'stat': result = await this.getFileInfo(request.path); break;
                    case 'read': await this.readRequest(request, controller.signal); break;
                    case 'import': await this.importRequest(request); return;
                    default: throw new Error('Unknown ProjFS request');
                }
                this.provider.complete(request.id, result, undefined);
            } catch (error) {
                const winErr = windowsError(error);
                if (request.id !== undefined) this.provider.complete(request.id, undefined, winErr);
                // Routine OS probes (e.g. desktop.ini, folder.jpg) return ENOENT on query/stat;
                // only surface actual I/O failures and import errors.
                const isBenignLookupMiss = (request.operation === 'query' || request.operation === 'stat') && winErr === 2;
                if (error.name !== 'AbortError' && !isBenignLookupMiss) {
                    this.emit('operationError', {operation: request.operation, path: request.path, error});
                }
            } finally { this.requests.delete(request.id); }
        })();
        this.work.add(operation);
        void operation.finally(() => this.work.delete(operation));
    }

    /** Mount without deleting or resetting existing filesystem state. */
    async start(virtualRoot = this.virtualRoot) {
        if (this.isRunning()) throw new Error('Already mounted');
        this.virtualRoot = path.resolve(virtualRoot);
        await mkdir(this.virtualRoot, {recursive: true});
        this.closing = false;
        this.provider.start(this.virtualRoot, this.dispatch.bind(this), Boolean(this.importLocal));
    }
    /** Alias used by native provider callers. */
    async mount() { await this.start(); }
    /** Stop incoming OS callbacks, then drain active owner reads before runtime shutdown. */
    async stop() {
        this.closing = true;
        for (const controller of this.requests.values()) controller.abort();
        this.provider.stop();
        await Promise.all([...this.work]);
    }
    /** Alias used by native provider callers. */
    async unmount() { await this.stop(); }
    /** Refresh clean projected children while preserving locally modified/full files. */
    async refresh(containers) {
        const paths = [...new Set(containers.map(canonical))].sort((a, b) => a.length - b.length);
        const roots = [];
        for (const target of paths) {
            if (!roots.some(root => root === '/' || target.startsWith(root + '/'))) roots.push(target);
        }
        for (const target of roots) this.provider.invalidate(target);
    }
    /** Whether ProjFS currently accepts OS requests. */
    isRunning() { return this.provider.isRunning(); }
    /** Native request counts and the shared process-wide read reservations. */
    getStats() { return {...this.provider.getStats(), reads: filerReadBudget.getUsage()}; }
}

export default IFSProjFSProvider;
