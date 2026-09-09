import '@refinio/one.core/lib/system/load-nodejs.js';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {basename} from 'node:path';
import {FileProviderRpc, FilerRuntime} from '@refinio/api/filer';
import {RestServer} from '@refinio/api/servers';
import {OperationRegistry} from '@refinio/api/registry';
import {FotosFileSystem, FotosRecipes} from '@refinio/fotos.core/filesystem';

/** Compose the Fotos-owned projection with the canonical Filer runtime. */
export async function createFotosApi(config) {
    const fotos = new FotosFileSystem(config.manifest ?? 'fotos', !config.readOnly);
    const runtime = new FilerRuntime({
        directory: config.directory, secret: config.secret, email: config.email,
        instanceName: config.name ?? 'Fotos Filer',
        commServerUrl: config.commServerUrl ?? 'wss://comm10.dev.refinio.one',
        inviteUrlPrefix: 'https://refinio.one/invite',
        recipes: FotosRecipes, fileSystems: new Map([['/fotos', fotos]]),
    });
    const fileSystem = await runtime.init();
    if (!config.readOnly) await fotos.init();
    const server = new RestServer(new OperationRegistry(), {
        host: '127.0.0.1', port: config.port,
        fileProviderRpc: new FileProviderRpc(fileSystem, config.token),
    });
    await server.start();
    return {runtime, fotos, server, async stop() { await server.stop(); await runtime.shutdown(); }};
}

/** Start a local Fotos endpoint using an explicit storage directory and credentials. */
async function main() {
    const {values} = parseArgs({options: {
        directory: {type: 'string'}, email: {type: 'string'}, port: {type: 'string', default: '49498'},
        manifest: {type: 'string', default: 'fotos'}, 'read-only': {type: 'boolean', default: false},
        'comm-server': {type: 'string'}, import: {type: 'string'},
    }});
    if (!values.directory || !values.email || !process.env.REFINIO_INSTANCE_SECRET || !process.env.REFINIO_FILER_TOKEN) {
        throw new Error('Set --directory, --email, REFINIO_INSTANCE_SECRET and REFINIO_FILER_TOKEN');
    }
    const api = await createFotosApi({directory: values.directory, email: values.email,
        secret: process.env.REFINIO_INSTANCE_SECRET, token: process.env.REFINIO_FILER_TOKEN,
        port: Number(values.port), manifest: values.manifest, readOnly: values['read-only'],
        commServerUrl: values['comm-server']});
    if (values.import) {
        const bytes = await readFile(values.import);
        await api.fotos.importFile(basename(values.import), Uint8Array.from(bytes).buffer);
    }
    console.log(`Fotos File Provider RPC: http://127.0.0.1:${values.port}/filer/rpc`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
        void api.stop().then(() => process.exit(0));
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error(error); process.exit(1); });
}
