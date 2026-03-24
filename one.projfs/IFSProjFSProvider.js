import { EventEmitter } from 'events';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const NativeProvider = require('./build/Release/ifsprojfs.node').IFSProjFSProvider;

const DEFAULT_VIRTUAL_ROOT = 'C:\\OneFiler';
const INVITES_RETRY_DELAY_MS = 100;
const INVITES_RETRY_COUNT = 10;
const ROOT_PATH = '/';
const ROOT_DIRECTORY_MODE = 16877;
const DEFAULT_FILE_MODE = 33188;

const enumerationCount = { count: 0 };

function shouldSuppressConsoleLogging() {
    return process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
}

function resolveLogFile(instancePath) {
    if (process.env.ONE_PROJFS_LOG_FILE) {
        return process.env.ONE_PROJFS_LOG_FILE;
    }

    if (!instancePath) {
        return null;
    }

    return path.join(instancePath, 'logs', 'projfs-operations.log');
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getEntryName(child) {
    if (typeof child === 'string') {
        const parts = child.split(/[\\/]/).filter(Boolean);
        return parts[parts.length - 1] || child;
    }

    if (child && typeof child === 'object') {
        return child.name || '';
    }

    return '';
}

function isDirectoryMode(mode) {
    return Boolean(mode && (mode & 0o040000) === 0o040000);
}

class IFSProjFSProvider extends EventEmitter {
    constructor(options) {
        super();

        if (typeof options === 'string') {
            this.instancePath = options;
            this.virtualRoot = DEFAULT_VIRTUAL_ROOT;
            this.fileSystem = null;
            this.debug = false;
        } else {
            this.instancePath = options?.instancePath;
            this.virtualRoot = options?.virtualRoot || DEFAULT_VIRTUAL_ROOT;
            this.fileSystem = options?.fileSystem ?? null;
            this.debug = options?.debug === true;
        }

        this.logFile = resolveLogFile(this.instancePath);
        this.logStream = null;
        this.inviteWatcher = null;
        this.callbacks = {
            createFile: null,
            getFileInfo: null,
            readDirectory: null,
            readFile: null
        };

        this.provider = new NativeProvider(this.instancePath);
        this.provider.registerCallbacks({
            createFile: this.createFile.bind(this),
            getFileInfo: this.getFileInfo.bind(this),
            onDebugMessage: this.onDebugMessage.bind(this),
            readDirectory: this.readDirectory.bind(this),
            readFile: this.readFile.bind(this)
        });
    }

    log(message, force = false) {
        if (!force && !this.debug) {
            return;
        }

        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;

        if (!shouldSuppressConsoleLogging()) {
            console.log(message);
        }

        if (!this.logFile) {
            return;
        }

        if (!this.logStream) {
            try {
                const dir = path.dirname(this.logFile);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
            } catch (error) {
                if (!shouldSuppressConsoleLogging()) {
                    console.error(`Failed to create ProjFS log file: ${error.message}`);
                }
                this.logFile = null;
                return;
            }
        }

        this.logStream.write(logMessage);
    }

    onDebugMessage(message) {
        this.log(`[Native] ${message}`);
    }

    normalizePath(inputPath) {
        if (!inputPath || typeof inputPath !== 'string') {
            return ROOT_PATH;
        }

        let normalized = inputPath
            .replace(/\\/g, '/')
            .replace(/^[A-Z]:/i, '')
            .replace(/^\/+OneFiler/i, '')
            .replace(/\/+/g, '/');

        if (!normalized.startsWith('/')) {
            normalized = '/' + normalized;
        }

        if (normalized.length > 1 && normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }

        return normalized || ROOT_PATH;
    }

    getHandler(methodName) {
        const callbackMap = {
            createFile: 'createFile',
            readDir: 'readDirectory',
            readFile: 'readFile',
            stat: 'getFileInfo',
            writeFile: 'createFile'
        };

        if (this.fileSystem && typeof this.fileSystem[methodName] === 'function') {
            return this.fileSystem[methodName].bind(this.fileSystem);
        }

        const callbackName = callbackMap[methodName];
        if (callbackName && typeof this.callbacks[callbackName] === 'function') {
            return this.callbacks[callbackName];
        }

        return null;
    }

    async callFileSystem(methodName, ...args) {
        const handler = this.getHandler(methodName);
        if (!handler) {
            throw new Error(`No file system handler available for ${methodName}`);
        }
        return handler(...args);
    }

    async getFileInfo(filePath) {
        const normalizedPath = this.normalizePath(filePath);
        this.log(`getFileInfo: "${filePath}" -> "${normalizedPath}"`);

        try {
            const name = String(filePath ?? '').split(/[\\/]/).filter(Boolean).pop() || '';

            if (normalizedPath === ROOT_PATH) {
                return {
                    hash: '',
                    isBlobOrClob: false,
                    isDirectory: true,
                    mode: ROOT_DIRECTORY_MODE,
                    name: '',
                    size: 0
                };
            }

            const info = await this.callFileSystem('stat', normalizedPath);
            const isDir = info.isDirectory || isDirectoryMode(info.mode);

            return {
                hash: info.hash || '',
                isBlobOrClob: false,
                isDirectory: isDir,
                mode: info.mode || (isDir ? ROOT_DIRECTORY_MODE : DEFAULT_FILE_MODE),
                name,
                size: info.size || 0
            };
        } catch (error) {
            this.log(`getFileInfo ERROR: ${error.message}`);
            return null;
        }
    }

    async readFile(filePath) {
        const normalizedPath = this.normalizePath(filePath);
        this.log(`readFile: "${filePath}" -> "${normalizedPath}"`);

        if (normalizedPath.startsWith('/objects/')) {
            this.log(`Skipping JS read for ${normalizedPath}; native layer handles /objects paths`);
            return null;
        }

        try {
            const file = await this.callFileSystem('readFile', normalizedPath);
            if (!file || !file.content) {
                this.log(`readFile: No content returned for ${normalizedPath}`);
                return null;
            }

            let buffer;
            if (Buffer.isBuffer(file.content)) {
                buffer = file.content;
            } else if (file.content instanceof ArrayBuffer) {
                buffer = Buffer.from(file.content);
            } else if (ArrayBuffer.isView(file.content)) {
                buffer = Buffer.from(file.content.buffer, file.content.byteOffset, file.content.byteLength);
            } else {
                buffer = Buffer.from(file.content);
            }

            this.log(`readFile SUCCESS: ${buffer.length} bytes for ${normalizedPath}`);

            if (typeof this.provider.setCachedContent === 'function') {
                this.provider.setCachedContent(normalizedPath, buffer);
            }

            if (typeof this.provider.completePendingFileRequests === 'function') {
                this.provider.completePendingFileRequests(normalizedPath);
            }

            return buffer;
        } catch (error) {
            this.log(`readFile ERROR: ${error.message}`);
            return null;
        }
    }

    async readDirectory(directoryPath) {
        enumerationCount.count++;

        const normalizedPath = this.normalizePath(directoryPath);
        this.log(`readDirectory #${enumerationCount.count}: "${directoryPath}" -> "${normalizedPath}"`);

        try {
            const dir = await this.callFileSystem('readDir', normalizedPath);
            if (!dir?.children || !Array.isArray(dir.children)) {
                this.log(`readDirectory: No children for ${normalizedPath}`);
                return [];
            }

            const rootChildNames = new Set(
                normalizedPath === ROOT_PATH
                    ? dir.children.filter(child => typeof child === 'string').map(child => String(child).trim())
                    : []
            );

            const entries = [];
            const seen = new Set();

            for (const child of dir.children) {
                const name = String(getEntryName(child)).trim();
                if (!name || name.includes('/') || name.includes('\\') || seen.has(name)) {
                    continue;
                }

                seen.add(name);
                const childPath = normalizedPath === ROOT_PATH ? `/${name}` : `${normalizedPath}/${name}`;

                try {
                    const info = await this.callFileSystem('stat', childPath);
                    const isDirectory = normalizedPath === ROOT_PATH
                        ? rootChildNames.has(name)
                        : info.isDirectory || isDirectoryMode(info.mode);

                    entries.push({
                        hash: info.hash || '',
                        isBlobOrClob: false,
                        isDirectory,
                        mode: info.mode || (isDirectory ? ROOT_DIRECTORY_MODE : DEFAULT_FILE_MODE),
                        name,
                        size: info.size || 0
                    });
                } catch (error) {
                    this.log(`Failed to stat ${childPath}: ${error.message}`);
                }
            }

            const validEntries = entries.filter(entry => entry.name.length > 0);
            this.setCachedDirectory(normalizedPath, validEntries);

            for (const entry of validEntries) {
                const entryPath = normalizedPath === ROOT_PATH ? `/${entry.name}` : `${normalizedPath}/${entry.name}`;
                this.setCachedFileInfo(entryPath, entry);
            }

            return validEntries;
        } catch (error) {
            this.log(`readDirectory ERROR: ${error.message}`);
            return [];
        }
    }

    async createFile(filePath, content) {
        const normalizedPath = this.normalizePath(filePath);
        this.log(`createFile: "${filePath}" -> "${normalizedPath}"`);
        await this.callFileSystem('writeFile', normalizedPath, content);
    }

    getCacheStats() {
        if (this.provider && typeof this.provider.getCacheStats === 'function') {
            return this.provider.getCacheStats();
        }

        return {
            contentCount: 0,
            directoryCount: 0,
            fileInfoCount: 0
        };
    }

    setCachedContent(filePath, content) {
        const normalizedPath = this.normalizePath(filePath);
        this.log(`setCachedContent: ${content ? content.length : 0} bytes for "${normalizedPath}"`);

        if (typeof this.provider.setCachedContent === 'function') {
            this.provider.setCachedContent(normalizedPath, content);
        }
    }

    setCachedDirectory(directoryPath, entries) {
        const normalizedPath = this.normalizePath(directoryPath);
        this.log(`setCachedDirectory: ${entries ? entries.length : 0} entries for "${normalizedPath}"`);

        if (typeof this.provider.setCachedDirectory === 'function') {
            this.provider.setCachedDirectory(normalizedPath, entries);
        }
    }

    setCachedFileInfo(filePath, fileInfo) {
        const normalizedPath = this.normalizePath(filePath);
        this.log(`setCachedFileInfo: "${normalizedPath}"`);

        if (typeof this.provider.setCachedFileInfo === 'function') {
            this.provider.setCachedFileInfo(normalizedPath, fileInfo);
        }
    }

    async waitForInviteEnumeration(invitesPath) {
        for (let attempt = 0; attempt < INVITES_RETRY_COUNT; attempt++) {
            try {
                const files = fs.readdirSync(invitesPath);
                if (files.length > 0) {
                    this.log(`Windows enumerated /invites with ${files.length} files`);
                    return files;
                }
            } catch (error) {
                this.log(`Retry ${attempt + 1} reading /invites: ${error.message}`);
            }

            await delay(INVITES_RETRY_DELAY_MS);
        }

        this.log('/invites enumeration returned 0 files after retries', true);
        return [];
    }

    invalidateInviteCaches(virtualPath) {
        if (typeof this.provider.clearCachedFileInfo === 'function') {
            this.provider.clearCachedFileInfo(virtualPath);
        }

        if (typeof this.provider.clearCachedContent === 'function') {
            this.provider.clearCachedContent(virtualPath);
        }

        if (typeof this.provider.invalidateTombstone === 'function') {
            const success = this.provider.invalidateTombstone(virtualPath);
            if (!success) {
                this.log(`Failed to invalidate tombstone for ${virtualPath}`, true);
            }
        }
    }

    async mount() {
        this.log(`Mounting at ${this.virtualRoot}`, true);
        enumerationCount.count = 0;

        if (this.fileSystem || this.callbacks.readDirectory) {
            try {
                const rootEntries = await this.readDirectory(ROOT_PATH);
                this.log(`Pre-populated root with ${rootEntries.length} entries`);
            } catch (error) {
                this.log(`Failed to pre-populate root: ${error.message}`, true);
            }

            try {
                const inviteEntries = await this.readDirectory('/invites');
                this.log(`Pre-populated /invites with ${inviteEntries.length} entries`);
            } catch (error) {
                this.log(`Could not pre-populate /invites: ${error.message}`);
            }
        }

        await this.provider.start(this.virtualRoot);
        this.log('Mount completed', true);

        try {
            const invitesPath = path.join(this.virtualRoot, 'invites');
            await this.waitForInviteEnumeration(invitesPath);

            this.inviteWatcher = fs.watch(invitesPath, (eventType, filename) => {
                if (eventType !== 'rename' || !filename) {
                    return;
                }

                const filePath = path.join(invitesPath, filename);
                if (fs.existsSync(filePath)) {
                    this.log(`Invite file created or restored: ${filename}`);
                    return;
                }

                const virtualPath = `/invites/${filename}`;
                this.log(`Invite file deleted: ${filename}`, true);
                this.invalidateInviteCaches(virtualPath);
            });

            this.log('Invite file monitoring active');
        } catch (error) {
            this.log(`Failed to set up invite monitoring: ${error.message}`, true);
        }
    }

    async start(virtualRoot) {
        this.virtualRoot = virtualRoot || this.virtualRoot;
        return this.mount();
    }

    async unmount() {
        this.log(`Unmounting from ${this.virtualRoot} after ${enumerationCount.count} enumerations`, true);

        if (this.inviteWatcher) {
            try {
                this.inviteWatcher.close();
            } catch (error) {
                this.log(`Failed to close invite watcher: ${error.message}`, true);
            }
            this.inviteWatcher = null;
        }

        await this.provider.stop();

        if (this.logStream) {
            this.logStream.end();
            this.logStream = null;
        }
    }

    async stop() {
        return this.unmount();
    }

    isRunning() {
        return this.provider && typeof this.provider.isRunning === 'function'
            ? this.provider.isRunning()
            : false;
    }

    getStats() {
        return this.provider && typeof this.provider.getStats === 'function'
            ? this.provider.getStats()
            : {};
    }

    setDebug(enabled) {
        this.debug = enabled === true;
    }

    registerCallbacks(callbacks) {
        if (callbacks.createFile) {
            this.callbacks.createFile = callbacks.createFile;
        }
        if (callbacks.getFileInfo) {
            this.callbacks.getFileInfo = callbacks.getFileInfo;
        }
        if (callbacks.readDirectory) {
            this.callbacks.readDirectory = callbacks.readDirectory;
        }
        if (callbacks.readFile) {
            this.callbacks.readFile = callbacks.readFile;
        }

        if (this.provider && typeof this.provider.registerCallbacks === 'function') {
            this.provider.registerCallbacks({
                createFile: this.createFile.bind(this),
                getFileInfo: this.getFileInfo.bind(this),
                onDebugMessage: this.onDebugMessage.bind(this),
                readDirectory: this.readDirectory.bind(this),
                readFile: this.readFile.bind(this)
            });
        }
    }

    completePendingFileRequests(filePath) {
        if (this.provider && typeof this.provider.completePendingFileRequests === 'function') {
            this.provider.completePendingFileRequests(filePath);
        }
    }
}

export default IFSProjFSProvider;
