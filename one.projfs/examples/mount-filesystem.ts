import {IFSProjFSProvider, type ProjectedFileSystem} from '@refinio/one.projfs';

/** Mount an initialized canonical filesystem; the caller owns runtime shutdown. */
export async function mountFileSystem(fileSystem: ProjectedFileSystem, virtualRoot: string): Promise<IFSProjFSProvider> {
    const provider = new IFSProjFSProvider({fileSystem, virtualRoot});
    provider.on('operationError', error => console.error('Projection failed', error));
    await provider.start();
    return provider;
}
