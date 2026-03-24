/**
 * Windows FUSE Adapter
 * 
 * This adapter extends the existing FuseApiToIFileSystemAdapter to provide Windows-specific
 * file attribute handling, extended attributes, and alternate data streams support.
 * 
 * @author ONE.filer Team
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 */

import type {Stats as FuseStats} from '../fuse/native-fuse3.js';
import FuseApiToIFileSystemAdapter from './FuseApiToIFileSystemAdapter.js';
import WindowsFileSystemAdapter, {WindowsFileAttributes, type WindowsFileMetadata} from '../fileSystems/WindowsFileSystemAdapter.js';
import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem.js';
import {createError} from '@refinio/one.core/lib/errors.js';
import {FS_ERRORS} from '@refinio/one.models/lib/fileSystems/FileSystemErrors.js';
import {handleError} from '../misc/fuseHelper.js';

/**
 * Windows FUSE Adapter
 * 
 * Extends the base FUSE adapter to provide Windows-specific functionality including:
 * - Windows file attributes (hidden, system, read-only, etc.)
 * - Extended attributes (xattr) support
 * - Alternate data streams
 * - Windows-specific error handling
 */
export default class WindowsFuseAdapter extends FuseApiToIFileSystemAdapter {
    private readonly windowsFs: WindowsFileSystemAdapter;
    protected readonly logCallsEnabled: boolean;

    constructor(fs: IFileSystem, oneStoragePath: string, logCalls: boolean = false) {
        // Create Windows adapter
        const windowsFs = new WindowsFileSystemAdapter(fs);
        
        // Use type assertion to bypass the interface mismatch - the base adapter
        // incorrectly assumes Buffer but actually works with ArrayBuffer
        super(windowsFs as any, oneStoragePath, logCalls);
        this.windowsFs = windowsFs;
        this.logCallsEnabled = logCalls;
    }

    /**
     * Enhanced getattr with Windows file attributes
     */
    public fuseGetattr(path: string, cb: (err: number, stat?: FuseStats) => void): void {
        // Call the base implementation first
        super.fuseGetattr(path, (err: number, stat?: FuseStats) => {
            if (err !== 0 || !stat) {
                cb(err, stat);
                return;
            }

            // Enhance with Windows attributes
            this.enhanceStatWithWindowsAttributes(path, stat)
                .then(enhancedStat => cb(0, enhancedStat))
                .catch(error => cb(handleError(error, this.logCallsEnabled, 'getattr')));
        });
    }

    /**
     * Windows extended attributes support
     */
    public fuseSetxattr(
        path: string,
        name: string,
        value: Buffer,
        size: number,
        flags: number,
        cb: (err: number) => void
    ): void {
        this.handleWindowsExtendedAttribute(path, name, value, 'set')
            .then(() => cb(0))
            .catch(err => cb(handleError(err, this.logCallsEnabled, 'setxattr')));
    }

    /**
     * Get Windows extended attributes
     */
    public fuseGetxattr(
        path: string,
        name: string,
        size: number,
        cb: (err: number, xattr?: Buffer | null) => void
    ): void {
        this.handleWindowsExtendedAttribute(path, name, null, 'get')
            .then(value => cb(0, value))
            .catch(err => cb(handleError(err, this.logCallsEnabled, 'getxattr'), null));
    }

    /**
     * List Windows extended attributes
     */
    public fuseListxattr(path: string, cb: (err: number, list?: string[]) => void): void {
        this.getWindowsExtendedAttributeList(path)
            .then(list => cb(0, list))
            .catch(err => cb(handleError(err, this.logCallsEnabled, 'listxattr')));
    }

    /**
     * Remove Windows extended attributes
     */
    public fuseRemovexattr(path: string, name: string, cb: (err: number) => void): void {
        this.handleWindowsExtendedAttribute(path, name, null, 'remove')
            .then(() => cb(0))
            .catch(err => cb(handleError(err, this.logCallsEnabled, 'removexattr')));
    }

    /**
     * Enhanced chmod with Windows attribute support
     */
    public fuseChmod(path: string, mode: number, cb: (err: number) => void): void {
        // Extract Windows attributes from mode
        const windowsAttributes = this.extractWindowsAttributesFromMode(mode);
        
        Promise.all([
            this.windowsFs.chmod(path, mode),
            this.windowsFs.setWindowsAttributes(path, windowsAttributes)
        ])
            .then(() => cb(0))
            .catch(err => cb(handleError(err, this.logCallsEnabled, 'chmod')));
    }

    /**
     * Enhanced create with Windows attributes
     */
    public fuseCreate(
        givenPath: string,
        mode: number,
        cb: (err: number, fd?: number, modePassedOn?: number) => void
    ): void {
        // Call base implementation
        super.fuseCreate(givenPath, mode, (err: number, fd?: number, modePassedOn?: number) => {
            if (err !== 0) {
                cb(err, fd, modePassedOn);
                return;
            }

            // Set Windows attributes for new file
            const windowsAttributes = this.extractWindowsAttributesFromMode(mode);
            this.windowsFs.setWindowsAttributes(givenPath, windowsAttributes)
                .then(() => cb(0, fd, modePassedOn))
                .catch(error => cb(handleError(error, this.logCallsEnabled, 'create'), fd, modePassedOn));
        });
    }

    /**
     * Enhanced mkdir with Windows attributes
     */
    public fuseMkdir(dirPath: string, mode: number, cb: (err: number) => void): void {
        const windowsAttributes = this.extractWindowsAttributesFromMode(mode) | WindowsFileAttributes.DIRECTORY;
        
        this.windowsFs.createDir(dirPath, mode)
            .then(() => this.windowsFs.setWindowsAttributes(dirPath, windowsAttributes))
            .then(() => cb(0))
            .catch(err => cb(handleError(err, this.logCallsEnabled, 'mkdir')));
    }

    /**
     * Override fuseRead to properly handle ArrayBuffer to Buffer conversion
     */
    public fuseRead(
        givenPath: string,
        _fd: number,
        buffer: Buffer,
        length: number,
        position: number,
        cb: (err: number, bytesRead?: number) => void
    ): void {
        if (this.windowsFs.supportsChunkedReading(givenPath)) {
            this.windowsFs
                .readFileInChunks(givenPath, length, position)
                .then((res: {content: ArrayBuffer}) => {
                    // Convert ArrayBuffer to Buffer properly
                    const bufferR = Buffer.from(res.content);
                    bufferR.copy(buffer);
                    cb(0, bufferR.length);
                })
                .catch((err: Error) => cb(handleError(err, this.logCallsEnabled), 0));
        } else {
            // If chunked reading is not supported, fall back to regular read
            this.windowsFs
                .readFile(givenPath)
                .then((res: {content: ArrayBuffer}) => {
                    const bufferR = Buffer.from(res.content);
                    const bytesToCopy = Math.min(length, bufferR.length - position);
                    if (bytesToCopy > 0) {
                        bufferR.subarray(position, position + bytesToCopy).copy(buffer);
                    }
                    cb(0, bytesToCopy);
                })
                .catch((err: Error) => cb(handleError(err, this.logCallsEnabled), 0));
        }
    }

    // Private helper methods

    private async enhanceStatWithWindowsAttributes(path: string, stat: FuseStats): Promise<FuseStats> {
        try {
            const windowsAttributes = await this.windowsFs.getWindowsAttributes(path);
            
            // Modify mode to include Windows attributes
            const enhancedMode = this.combineUnixModeWithWindowsAttributes(stat.mode, windowsAttributes);
            
            return {
                ...stat,
                mode: enhancedMode
            };
        } catch (error) {
            // If we can't get Windows attributes, return original stat
            return stat;
        }
    }

    private async handleWindowsExtendedAttribute(
        path: string,
        name: string,
        value: Buffer | null,
        operation: 'set' | 'get' | 'remove'
    ): Promise<Buffer | null> {
        // Handle Windows-specific extended attributes
        switch (name) {
            case 'user.windows.attributes':
                return await this.handleWindowsAttributesXattr(path, value, operation);
            
            case 'user.windows.streams':
                return await this.handleAlternateDataStreamsXattr(path, value, operation);
            
            case 'user.windows.acl':
                return await this.handleWindowsAclXattr(path, value, operation);
            
            default:
                // Handle as regular extended attribute
                if (name.startsWith('user.windows.stream.')) {
                    const streamName = name.substring('user.windows.stream.'.length);
                    return await this.handleSpecificAlternateDataStream(path, streamName, value, operation);
                }
                
                // For other attributes, return empty or throw not supported
                if (operation === 'get') {
                    return null;
                } else if (operation === 'set' || operation === 'remove') {
                    throw createError('FSE-ENOSYS', {
                        message: `Extended attribute '${name}' not supported`,
                        path
                    });
                }
                return null;
        }
    }

    private async handleWindowsAttributesXattr(
        path: string,
        value: Buffer | null,
        operation: 'set' | 'get' | 'remove'
    ): Promise<Buffer | null> {
        switch (operation) {
            case 'get':
                const attributes = await this.windowsFs.getWindowsAttributes(path);
                return Buffer.from(attributes.toString(16), 'hex');
            
            case 'set':
                if (!value) throw createError('FSE-EINVAL', {message: 'Value required for set operation', path});
                const newAttributes = parseInt(value.toString('hex'), 16);
                await this.windowsFs.setWindowsAttributes(path, newAttributes);
                return null;
            
            case 'remove':
                await this.windowsFs.setWindowsAttributes(path, WindowsFileAttributes.NORMAL);
                return null;
        }
    }

    private async handleAlternateDataStreamsXattr(
        path: string,
        value: Buffer | null,
        operation: 'set' | 'get' | 'remove'
    ): Promise<Buffer | null> {
        switch (operation) {
            case 'get':
                const streams = await this.windowsFs.listAlternateDataStreams(path);
                return Buffer.from(JSON.stringify(streams), 'utf8');
            
            case 'set':
            case 'remove':
                throw createError('FSE-ENOSYS', {
                    message: 'Use specific stream attributes to modify alternate data streams',
                    path
                });
        }
    }

    private async handleSpecificAlternateDataStream(
        path: string,
        streamName: string,
        value: Buffer | null,
        operation: 'set' | 'get' | 'remove'
    ): Promise<Buffer | null> {
        switch (operation) {
            case 'get':
                const streamHash = await this.windowsFs.getAlternateDataStream(path, streamName);
                return streamHash ? Buffer.from(streamHash, 'hex') : null;
            
            case 'set':
                if (!value) throw createError('FSE-EINVAL', {message: 'Value required for set operation', path});
                // In a real implementation, this would store the value as a BLOB and get its hash
                const hash = value.toString('hex') as any; // Simplified for demo
                await this.windowsFs.setAlternateDataStream(path, streamName, hash);
                return null;
            
            case 'remove':
                // In a real implementation, this would remove the alternate data stream
                return null;
        }
    }

    private async handleWindowsAclXattr(
        path: string,
        value: Buffer | null,
        operation: 'set' | 'get' | 'remove'
    ): Promise<Buffer | null> {
        // Placeholder for Windows ACL handling
        // In a real implementation, this would handle Windows Access Control Lists
        switch (operation) {
            case 'get':
                return Buffer.from('[]', 'utf8'); // Empty ACL list
            
            case 'set':
            case 'remove':
                // ACL operations would be implemented here
                return null;
        }
    }

    private async getWindowsExtendedAttributeList(path: string): Promise<string[]> {
        const attributes = ['user.windows.attributes'];
        
        // Check if file has alternate data streams
        const streams = await this.windowsFs.listAlternateDataStreams(path);
        if (streams.length > 0) {
            attributes.push('user.windows.streams');
            // Add individual stream attributes
            streams.forEach(stream => {
                attributes.push(`user.windows.stream.${stream}`);
            });
        }
        
        // Add ACL attribute
        attributes.push('user.windows.acl');
        
        return attributes;
    }

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
        
        // Set hidden files as not readable by others
        if (windowsAttributes & WindowsFileAttributes.HIDDEN) {
            combinedMode &= ~0o044; // Remove read permission for group and others
        }
        
        // Embed Windows attributes in upper 16 bits
        combinedMode |= (windowsAttributes << 16);
        
        return combinedMode;
    }
} 