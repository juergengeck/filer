/**
 * Native IFileSystem to ProjFS bridge for ONE
 */

import { EventEmitter } from 'events';

export type IFSProjFSProviderOptions = {
    instancePath: string;
    virtualRoot: string;
    fileSystem: any; // IFileSystem interface from one.models
    cacheTTL?: number;
    debug?: boolean;
};

export type ProviderStats = {
    placeholderRequests: number;
    fileDataRequests: number;
    directoryEnumerations: number;
    bytesRead: bigint;
    cacheHits: number;
    cacheMisses: number;
};

export declare class IFSProjFSProvider extends EventEmitter {
    /**
     * Create a new ProjFS provider for a ONE instance
     */
    constructor(options: IFSProjFSProviderOptions);

    /**
     * Register JavaScript callbacks for IFileSystem integration
     */
    registerCallbacks(callbacks: {
        getFileInfo?: (path: string) => Promise<any>;
        readFile?: (path: string) => Promise<Buffer>;
        readDirectory?: (path: string) => Promise<any[]>;
        createFile?: (path: string, content: Buffer) => Promise<void>;
    }): void;

    /**
     * Mount the ProjFS virtual filesystem
     */
    mount(): Promise<void>;
    start(virtualRoot?: string): Promise<void>;

    /**
     * Unmount the ProjFS virtual filesystem
     */
    unmount(): Promise<void>;
    stop(): Promise<void>;

    /**
     * Check if the provider is currently running
     */
    isRunning(): boolean;

    /**
     * Get provider statistics
     */
    getStats(): ProviderStats;

    /**
     * Enable/disable debug mode
     */
    setDebug(enabled: boolean): void;

    getCacheStats(): Record<string, unknown>;

    completePendingFileRequests(path: string): void;
}
