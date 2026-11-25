import {EventEmitter} from 'node:events';
import type {RangeFileSystem} from '@refinio/filer.core/reads';

export type ProjectedFileSystem = RangeFileSystem & {
    stat(path: string): Promise<{mode: number; size: number; contentHash?: string; metadataHash?: string;
        item?: {contentVersion: string; metadataVersion: string}}>;
    readDir(path: string): Promise<{children: string[]}>;
};
export type IFSProjFSProviderOptions = {
    virtualRoot: string;
    fileSystem: ProjectedFileSystem;
    importLocal?: (virtualPath: string, localPath: string, directory: boolean) => Promise<void>;
};
/** Native Windows projection; shared owners supply metadata, bounded reads and imports. */
export declare class IFSProjFSProvider extends EventEmitter {
    constructor(options: IFSProjFSProviderOptions);
    start(virtualRoot?: string): Promise<void>;
    mount(): Promise<void>;
    stop(): Promise<void>;
    unmount(): Promise<void>;
    isRunning(): boolean;
    refresh(containers: string[]): Promise<void>;
    getStats(): {bytesRead: bigint; rangeWrites: number; pending: number; enumerations: number;
        reads: {active: number; queued: number; peak: number; reservedBytes: number}};
}
export default IFSProjFSProvider;
