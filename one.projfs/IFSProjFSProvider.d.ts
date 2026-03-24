import { IFileSystem } from '@refinio/one.models/lib/fileSystems/IFileSystem.js';

export type IFSProjFSProviderOptions = {
    instancePath: string;
    virtualRoot: string;
    fileSystem: IFileSystem;
    debug?: boolean;
};

export class IFSProjFSProvider {
    constructor(options: IFSProjFSProviderOptions | string);
    mount(): Promise<void>;
    start(virtualRoot?: string): Promise<void>;
    unmount(): Promise<void>;
    stop(): Promise<void>;
    isRunning(): boolean;
    getStats(): Record<string, unknown>;
    getCacheStats(): Record<string, unknown>;
    setDebug(enabled: boolean): void;
    registerCallbacks(callbacks: {
        createFile?: (path: string, content: Buffer) => Promise<void>;
        getFileInfo?: (path: string) => Promise<unknown>;
        readDirectory?: (path: string) => Promise<unknown[]>;
        readFile?: (path: string) => Promise<Buffer | null>;
    }): void;
    completePendingFileRequests(path: string): void;
}
