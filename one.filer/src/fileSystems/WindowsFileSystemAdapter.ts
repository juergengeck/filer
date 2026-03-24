/**
 * Windows File System Integration Adapter
 * 
 * This adapter provides Windows-specific file system behavior by mapping Windows file attributes
 * to ONE object metadata and handling Windows file permissions, attributes, and behaviors.
 * 
 * @author ONE.filer Team
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 */

import type {
    FileDescription,
    FileSystemDirectory,
    FileSystemFile,
    IFileSystem
} from '@refinio/one.models/lib/fileSystems/IFileSystem.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BLOB} from '@refinio/one.core/lib/recipes.js';
import {createError} from '@refinio/one.core/lib/errors.js';
import {FS_ERRORS} from '@refinio/one.models/lib/fileSystems/FileSystemErrors.js';

/**
 * Windows File Attributes as defined by Microsoft
 * @see https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fscc/ca28ec38-f155-4768-81d6-4bfeb8586fc9
 */
export enum WindowsFileAttributes {
    READONLY = 0x00000001,
    HIDDEN = 0x00000002,
    SYSTEM = 0x00000004,
    DIRECTORY = 0x00000010,
    ARCHIVE = 0x00000020,
    NORMAL = 0x00000080,
    TEMPORARY = 0x00000100,
    SPARSE_FILE = 0x00000200,
    REPARSE_POINT = 0x00000400,
    COMPRESSED = 0x00000800,
    OFFLINE = 0x00001000,
    NOT_CONTENT_INDEXED = 0x00002000,
    ENCRYPTED = 0x00004000,
    INTEGRITY_STREAM = 0x00008000,
    NO_SCRUB_DATA = 0x00020000,
    RECALL_ON_OPEN = 0x00040000,
    PINNED = 0x00080000,
    UNPINNED = 0x00100000,
    RECALL_ON_DATA_ACCESS = 0x00400000
}

/**
 * Windows file attribute metadata stored in ONE objects
 */
export interface WindowsFileMetadata {
    /** Windows file attributes bitmask */
    attributes: number;
    /** Creation time (Windows FILETIME format) */
    creationTime?: Date;
    /** Last access time */
    lastAccessTime?: Date;
    /** Last write time */
    lastWriteTime?: Date;
    /** File owner SID (Security Identifier) */
    ownerSid?: string;
    /** File group SID */
    groupSid?: string;
    /** Windows ACL (Access Control List) */
    acl?: WindowsAcl[];
    /** Alternate data streams */
    alternateDataStreams?: {[streamName: string]: SHA256Hash<BLOB>};
    /** Extended attributes */
    extendedAttributes?: {[name: string]: ArrayBuffer};
}

/**
 * Windows Access Control Entry
 */
export interface WindowsAcl {
    /** Access Control Entry type */
    type: 'ALLOW' | 'DENY' | 'AUDIT';
    /** Security Identifier */
    sid: string;
    /** Access mask */
    accessMask: number;
    /** Inheritance flags */
    inheritanceFlags?: number;
}

/**
 * Windows File System Integration Adapter
 * 
 * This class wraps an existing IFileSystem implementation and adds Windows-specific
 * file attribute handling, permissions, and behaviors.
 */
export default class WindowsFileSystemAdapter implements IFileSystem {
    private readonly baseFileSystem: IFileSystem;
    private readonly metadataCache = new Map<string, WindowsFileMetadata>();

    constructor(baseFileSystem: IFileSystem) {
        this.baseFileSystem = baseFileSystem;
    }

    /**
     * Creates a directory with Windows-specific attributes
     */
    async createDir(directoryPath: string, dirMode: number): Promise<void> {
        // Extract Windows attributes from mode
        const windowsAttributes = this.extractWindowsAttributesFromMode(dirMode);
        
        // Create the directory using the base file system
        await this.baseFileSystem.createDir(directoryPath, dirMode);
        
        // Store Windows metadata
        const metadata: WindowsFileMetadata = {
            attributes: windowsAttributes | WindowsFileAttributes.DIRECTORY,
            creationTime: new Date(),
            lastAccessTime: new Date(),
            lastWriteTime: new Date()
        };
        
        this.metadataCache.set(directoryPath, metadata);
        await this.persistWindowsMetadata(directoryPath, metadata);
    }

    /**
     * Creates a file with Windows-specific attributes
     */
    async createFile(
        directoryPath: string,
        fileHash: SHA256Hash<BLOB>,
        fileName: string,
        fileMode: number
    ): Promise<void> {
        const filePath = this.joinPath(directoryPath, fileName);
        const windowsAttributes = this.extractWindowsAttributesFromMode(fileMode);
        
        // Create the file using the base file system
        await this.baseFileSystem.createFile(directoryPath, fileHash, fileName, fileMode);
        
        // Store Windows metadata
        const metadata: WindowsFileMetadata = {
            attributes: windowsAttributes,
            creationTime: new Date(),
            lastAccessTime: new Date(),
            lastWriteTime: new Date()
        };
        
        this.metadataCache.set(filePath, metadata);
        await this.persistWindowsMetadata(filePath, metadata);
    }

    /**
     * Reads a directory with Windows attribute information
     */
    async readDir(dirPath: string): Promise<FileSystemDirectory> {
        const directory = await this.baseFileSystem.readDir(dirPath);
        
        // Update last access time
        await this.updateLastAccessTime(dirPath);
        
        return directory;
    }

    /**
     * Reads a file with Windows attribute handling
     */
    async readFile(filePath: string): Promise<FileSystemFile> {
        const metadata = await this.getWindowsMetadata(filePath);
        
        // Check if file is offline (hierarchical storage)
        if (metadata?.attributes && (metadata.attributes & WindowsFileAttributes.OFFLINE)) {
            throw createError('FSE-OFFLINE', {
                message: 'File data is not available immediately (offline storage)',
                path: filePath
            });
        }
        
        // Check if file requires recall on data access
        if (metadata?.attributes && (metadata.attributes & WindowsFileAttributes.RECALL_ON_DATA_ACCESS)) {
            // Simulate recall operation (in real implementation, this would trigger data retrieval)
            console.log(`Recalling file data for: ${filePath}`);
        }
        
        const file = await this.baseFileSystem.readFile(filePath);
        
        // Update last access time
        await this.updateLastAccessTime(filePath);
        
        return file;
    }

    /**
     * Reads a symbolic link
     */
    async readlink(filePath: string): Promise<FileSystemFile> {
        return await this.baseFileSystem.readlink(filePath);
    }

    /**
     * Reads file in chunks with Windows attribute handling
     */
    async readFileInChunks(filePath: string, length: number, position: number): Promise<FileSystemFile> {
        const metadata = await this.getWindowsMetadata(filePath);
        
        // Check for sparse file optimization
        if (metadata?.attributes && (metadata.attributes & WindowsFileAttributes.SPARSE_FILE)) {
            // Handle sparse file reading (in real implementation, this would optimize for sparse regions)
            console.log(`Reading sparse file in chunks: ${filePath}`);
        }
        
        const file = await this.baseFileSystem.readFileInChunks(filePath, length, position);
        
        // Update last access time
        await this.updateLastAccessTime(filePath);
        
        return file;
    }

    /**
     * Checks if chunked reading is supported
     */
    supportsChunkedReading(path?: string): boolean {
        return this.baseFileSystem.supportsChunkedReading(path);
    }

    /**
     * Gets file statistics with Windows attributes
     */
    async stat(path: string): Promise<FileDescription> {
        const baseStat = await this.baseFileSystem.stat(path);
        const metadata = await this.getWindowsMetadata(path);
        
        // Enhance mode with Windows attributes
        let enhancedMode = baseStat.mode;
        if (metadata?.attributes) {
            enhancedMode = this.combineUnixModeWithWindowsAttributes(baseStat.mode, metadata.attributes);
        }
        
        return {
            mode: enhancedMode,
            size: baseStat.size
        };
    }

    /**
     * Removes a directory
     */
    async rmdir(pathName: string): Promise<number> {
        const metadata = await this.getWindowsMetadata(pathName);
        
        // Check if directory is read-only
        if (metadata?.attributes && (metadata.attributes & WindowsFileAttributes.READONLY)) {
            throw createError('FSE-EACCES-W', {
                message: FS_ERRORS['FSE-EACCES-W'].message,
                path: pathName
            });
        }
        
        const result = await this.baseFileSystem.rmdir(pathName);
        
        // Clean up metadata
        this.metadataCache.delete(pathName);
        await this.removeWindowsMetadata(pathName);
        
        return result;
    }

    /**
     * Removes a file
     */
    async unlink(pathName: string): Promise<number> {
        const metadata = await this.getWindowsMetadata(pathName);
        
        // Check if file is read-only
        if (metadata?.attributes && (metadata.attributes & WindowsFileAttributes.READONLY)) {
            throw createError('FSE-EACCES-W', {
                message: FS_ERRORS['FSE-EACCES-W'].message,
                path: pathName
            });
        }
        
        // Check if file is system file
        if (metadata?.attributes && (metadata.attributes & WindowsFileAttributes.SYSTEM)) {
            throw createError('FSE-EACCES-W', {
                message: 'Cannot delete system file',
                path: pathName
            });
        }
        
        const result = await this.baseFileSystem.unlink(pathName);
        
        // Clean up metadata
        this.metadataCache.delete(pathName);
        await this.removeWindowsMetadata(pathName);
        
        return result;
    }

    /**
     * Creates a symbolic link
     */
    async symlink(src: string, dest: string): Promise<void> {
        await this.baseFileSystem.symlink(src, dest);
        
        // Create metadata for the symlink
        const metadata: WindowsFileMetadata = {
            attributes: WindowsFileAttributes.REPARSE_POINT,
            creationTime: new Date(),
            lastAccessTime: new Date(),
            lastWriteTime: new Date()
        };
        
        this.metadataCache.set(dest, metadata);
        await this.persistWindowsMetadata(dest, metadata);
    }

    /**
     * Renames a file or directory
     */
    async rename(src: string, dest: string): Promise<number> {
        const metadata = await this.getWindowsMetadata(src);
        
        // Check if source is read-only
        if (metadata?.attributes && (metadata.attributes & WindowsFileAttributes.READONLY)) {
            throw createError('FSE-EACCES-W', {
                message: FS_ERRORS['FSE-EACCES-W'].message,
                path: src
            });
        }
        
        const result = await this.baseFileSystem.rename(src, dest);
        
        // Move metadata
        if (metadata) {
            this.metadataCache.delete(src);
            this.metadataCache.set(dest, metadata);
            await this.removeWindowsMetadata(src);
            await this.persistWindowsMetadata(dest, metadata);
        }
        
        return result;
    }

    /**
     * Changes file permissions with Windows attribute support
     */
    async chmod(pathName: string, mode: number): Promise<number> {
        const windowsAttributes = this.extractWindowsAttributesFromMode(mode);
        const metadata = await this.getWindowsMetadata(pathName) || {
            attributes: WindowsFileAttributes.NORMAL,
            lastWriteTime: new Date()
        };
        
        // Update Windows attributes
        metadata.attributes = windowsAttributes;
        metadata.lastWriteTime = new Date();
        
        this.metadataCache.set(pathName, metadata);
        await this.persistWindowsMetadata(pathName, metadata);
        
        return await this.baseFileSystem.chmod(pathName, mode);
    }

    // Windows-specific methods

    /**
     * Sets Windows file attributes
     */
    async setWindowsAttributes(path: string, attributes: number): Promise<void> {
        const metadata = await this.getWindowsMetadata(path) || {
            attributes: WindowsFileAttributes.NORMAL
        };
        
        metadata.attributes = attributes;
        metadata.lastWriteTime = new Date();
        
        this.metadataCache.set(path, metadata);
        await this.persistWindowsMetadata(path, metadata);
    }

    /**
     * Gets Windows file attributes
     */
    async getWindowsAttributes(path: string): Promise<number> {
        const metadata = await this.getWindowsMetadata(path);
        return metadata?.attributes || WindowsFileAttributes.NORMAL;
    }

    /**
     * Sets alternate data stream
     */
    async setAlternateDataStream(path: string, streamName: string, data: SHA256Hash<BLOB>): Promise<void> {
        const metadata = await this.getWindowsMetadata(path) || {
            attributes: WindowsFileAttributes.NORMAL,
            alternateDataStreams: {}
        };
        
        if (!metadata.alternateDataStreams) {
            metadata.alternateDataStreams = {};
        }
        
        metadata.alternateDataStreams[streamName] = data;
        metadata.lastWriteTime = new Date();
        
        this.metadataCache.set(path, metadata);
        await this.persistWindowsMetadata(path, metadata);
    }

    /**
     * Gets alternate data stream
     */
    async getAlternateDataStream(path: string, streamName: string): Promise<SHA256Hash<BLOB> | undefined> {
        const metadata = await this.getWindowsMetadata(path);
        return metadata?.alternateDataStreams?.[streamName];
    }

    /**
     * Lists alternate data streams
     */
    async listAlternateDataStreams(path: string): Promise<string[]> {
        const metadata = await this.getWindowsMetadata(path);
        return Object.keys(metadata?.alternateDataStreams || {});
    }

    // Private helper methods

    private extractWindowsAttributesFromMode(mode: number): number {
        let attributes = WindowsFileAttributes.NORMAL;
        
        // Map Unix permissions to Windows attributes
        if ((mode & 0o200) === 0) { // No write permission
            attributes |= WindowsFileAttributes.READONLY;
        }
        
        if ((mode & 0o40000) !== 0) { // Directory
            attributes |= WindowsFileAttributes.DIRECTORY;
        }
        
        // Check for Windows-specific bits in the upper part of mode
        const windowsBits = (mode >> 16) & 0xFFFF;
        if (windowsBits) {
            attributes |= windowsBits;
        }
        
        return attributes;
    }

    private combineUnixModeWithWindowsAttributes(unixMode: number, windowsAttributes: number): number {
        let combinedMode = unixMode;
        
        // Set read-only if Windows read-only attribute is set
        if (windowsAttributes & WindowsFileAttributes.READONLY) {
            combinedMode &= ~0o200; // Remove write permission
        }
        
        // Embed Windows attributes in upper 16 bits
        combinedMode |= (windowsAttributes << 16);
        
        return combinedMode;
    }

    private async getWindowsMetadata(path: string): Promise<WindowsFileMetadata | undefined> {
        // Check cache first
        if (this.metadataCache.has(path)) {
            return this.metadataCache.get(path);
        }
        
        // Load from persistent storage (implementation would depend on ONE object storage)
        return await this.loadWindowsMetadata(path);
    }

    private async persistWindowsMetadata(path: string, metadata: WindowsFileMetadata): Promise<void> {
        // Implementation would store metadata as ONE object
        // For now, just keep in memory cache
        this.metadataCache.set(path, metadata);
    }

    private async loadWindowsMetadata(path: string): Promise<WindowsFileMetadata | undefined> {
        // Implementation would load metadata from ONE object storage
        // For now, return undefined (no metadata found)
        return undefined;
    }

    private async removeWindowsMetadata(path: string): Promise<void> {
        // Implementation would remove metadata from ONE object storage
        this.metadataCache.delete(path);
    }

    private async updateLastAccessTime(path: string): Promise<void> {
        const metadata = await this.getWindowsMetadata(path);
        if (metadata) {
            metadata.lastAccessTime = new Date();
            this.metadataCache.set(path, metadata);
            await this.persistWindowsMetadata(path, metadata);
        }
    }

    private joinPath(directory: string, fileName: string): string {
        if (directory.endsWith('/')) {
            return directory + fileName;
        }
        return directory + '/' + fileName;
    }
} 