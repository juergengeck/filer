/**
 * WSL2 FUSE Frontend for Windows Explorer Integration
 * 
 * This frontend runs in WSL2 Debian and provides Windows-specific functionality
 * for Windows Explorer integration. It uses the WindowsFuseAdapter to handle Windows
 * file attributes, extended attributes, and alternate data streams through FUSE.
 * 
 * @author ONE.filer Team
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 */

import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem.js';
import fs from 'fs';
import WindowsFuseAdapter from './WindowsFuseAdapter.js';
import {splitRoutePath} from '../misc/fuseHelper.js';

import { Fuse } from '../fuse/native-fuse3.js';
import {isFunction} from '@refinio/one.core/lib/util/type-checks-basic.js';

/**
 * WSL2 FUSE Frontend for Windows Explorer Integration
 * 
 * This class provides a FUSE frontend that runs in WSL2 Debian and:
 * - Uses WindowsFuseAdapter for Windows file attribute handling via extended attributes
 * - Configures mount points accessible from Windows via WSL2 file bridge
 * - Handles Windows-specific file operations through Linux FUSE
 * - Provides enhanced logging for Windows integration debugging
 */
export class WindowsFuseFrontend {
    private fuseInstance: null | Fuse = null;

    /**
     * Start the WSL2 FUSE frontend for Windows integration
     * 
     * @param rootFileSystem - The file system implementation that should be mounted
     * @param mountPoint - Linux mount point accessible from Windows (e.g., "/mnt/c/one-files")
     * @param logCalls - If true log all calls to console
     */
    public async start(
        rootFileSystem: IFileSystem,
        mountPoint: string,
        logCalls: boolean = false
    ): Promise<void> {
        if (this.fuseInstance) {
            throw Error('WSL2 Windows FUSE frontend already started');
        }

        // Ensure WSL2-compatible mount point setup
        WindowsFuseFrontend.setupWSL2MountPoint(mountPoint);

        // Create Windows-specific FUSE adapter (runs in Linux but handles Windows attributes)
        const windowsFuseAdapter = new WindowsFuseAdapter(
            rootFileSystem,
            mountPoint,
            logCalls
        );

        // Create map of file system handlers for fuse instance with Windows enhancements
        const fuseHandlers: any = {
            init: windowsFuseAdapter.fuseInit.bind(this),
            error: windowsFuseAdapter.fuseError.bind(this),
            access: windowsFuseAdapter.fuseAccess.bind(windowsFuseAdapter),
            statfs: windowsFuseAdapter.fuseStatfs.bind(windowsFuseAdapter),
            getattr: windowsFuseAdapter.fuseGetattr.bind(windowsFuseAdapter), // Enhanced with Windows attributes
            fgetattr: windowsFuseAdapter.fuseFgetattr.bind(windowsFuseAdapter),
            flush: windowsFuseAdapter.fuseFlush.bind(windowsFuseAdapter),
            fsync: windowsFuseAdapter.fuseFsync.bind(windowsFuseAdapter),
            fsyncdir: windowsFuseAdapter.fuseFsyncdir.bind(windowsFuseAdapter),
            readdir: windowsFuseAdapter.fuseReaddir.bind(windowsFuseAdapter),
            truncate: windowsFuseAdapter.fuseTruncate.bind(windowsFuseAdapter),
            ftruncate: windowsFuseAdapter.fuseFtruncate.bind(windowsFuseAdapter),
            readlink: windowsFuseAdapter.fuseReadlink.bind(windowsFuseAdapter),
            chown: windowsFuseAdapter.fuseChown.bind(windowsFuseAdapter),
            chmod: windowsFuseAdapter.fuseChmod.bind(windowsFuseAdapter), // Enhanced with Windows attributes
            mknod: windowsFuseAdapter.fuseMknod.bind(windowsFuseAdapter),
            setxattr: windowsFuseAdapter.fuseSetxattr.bind(windowsFuseAdapter), // Windows extended attributes
            getxattr: windowsFuseAdapter.fuseGetxattr.bind(windowsFuseAdapter), // Windows extended attributes
            listxattr: windowsFuseAdapter.fuseListxattr.bind(windowsFuseAdapter), // Windows extended attributes
            removexattr: windowsFuseAdapter.fuseRemovexattr.bind(windowsFuseAdapter), // Windows extended attributes
            open: windowsFuseAdapter.fuseOpen.bind(windowsFuseAdapter),
            opendir: windowsFuseAdapter.fuseOpendir.bind(windowsFuseAdapter),
            read: windowsFuseAdapter.fuseRead.bind(windowsFuseAdapter), // Enhanced ArrayBuffer to Buffer conversion
            write: windowsFuseAdapter.fuseWrite.bind(windowsFuseAdapter),
            release: windowsFuseAdapter.fuseRelease.bind(windowsFuseAdapter),
            releasedir: windowsFuseAdapter.fuseReleasedir.bind(windowsFuseAdapter),
            create: windowsFuseAdapter.fuseCreate.bind(windowsFuseAdapter), // Enhanced with Windows attributes
            utimens: windowsFuseAdapter.fuseUtimens.bind(windowsFuseAdapter),
            unlink: windowsFuseAdapter.fuseUnlink.bind(windowsFuseAdapter),
            rename: windowsFuseAdapter.fuseRename.bind(windowsFuseAdapter),
            link: windowsFuseAdapter.fuseLink.bind(windowsFuseAdapter),
            symlink: windowsFuseAdapter.fuseSymlink.bind(windowsFuseAdapter),
            mkdir: windowsFuseAdapter.fuseMkdir.bind(windowsFuseAdapter), // Enhanced with Windows attributes
            rmdir: windowsFuseAdapter.fuseRmdir.bind(windowsFuseAdapter)
        };

        // Enhanced logging for Windows debugging
        if (logCalls) {
            for (const handlerId in fuseHandlers) {
                const oldHandler = fuseHandlers[handlerId as keyof typeof fuseHandlers];

                if (handlerId === 'init') {
                    fuseHandlers[handlerId] = (...args: any[]) =>
                        WindowsFuseFrontend.logWindowsFuseCall(handlerId, oldHandler, ...args);
                } else {
                    fuseHandlers[handlerId as keyof typeof fuseHandlers] = (...args: any[]) =>
                        WindowsFuseFrontend.logWindowsFuseCallCB(
                            handlerId,
                            oldHandler as NonNullable<typeof oldHandler>,
                            ...args
                        );
                }
            }
        }

        // Create FUSE instance for WSL2 with Windows compatibility
        this.fuseInstance = new Fuse(mountPoint, fuseHandlers, {
            displayFolder: 'ONE Objects'
        });

        await new Promise<void>((resolve, reject) => {
            if (this.fuseInstance === null) {
                reject(Error('WSL2 Windows FUSE frontend not yet started'));
            } else {
                this.fuseInstance.mount(err => {
                    if (err === null) {
                        console.log(`🐧 WSL2 FUSE mounted successfully at ${mountPoint}`);
                        console.log(`🪟 Access via Windows Explorer: ${WindowsFuseFrontend.getWindowsPath(mountPoint)}`);
                        console.log(`🔗 Alternative: \\\\wsl$\\Debian${mountPoint}`);
                        resolve();
                    } else {
                        console.error(`❌ Failed to mount WSL2 FUSE at ${mountPoint}:`, err);
                        reject(err);
                    }
                });
            }
        });
    }

    /**
     * Stop the WSL2 FUSE frontend
     */
    public async stop(): Promise<void> {
        if (this.fuseInstance) {
            return new Promise((resolve, reject) => {
                if (this.fuseInstance === null) {
                    reject(Error('WSL2 Windows FUSE frontend not yet started'));
                } else {
                    this.fuseInstance.unmount(err => {
                        if (err === null) {
                            console.log('🐧 WSL2 FUSE unmounted successfully');
                            resolve();
                        } else {
                            console.error('❌ Failed to unmount WSL2 FUSE:', err);
                            reject(err);
                        }
                    });
                }
            });
        }
    }

    // ############### PRIVATE Interface ###############

    /**
     * Sets up the mount point correctly for WSL2 with Windows accessibility
     * 
     * @param mountPoint - Linux path accessible from Windows (e.g., "/mnt/c/one-files")
     */
    private static setupWSL2MountPoint(mountPoint: string): void {
        // Standard Linux mount point setup (we're running in WSL2 Debian)
        if (!fs.existsSync(mountPoint)) {
            fs.mkdirSync(mountPoint, { recursive: true });
            console.log(`🐧 Created WSL2 mount point: ${mountPoint}`);
        } else {
            console.log(`🐧 Using existing WSL2 mount point: ${mountPoint}`);
        }
    }

    /**
     * Convert Linux mount point to Windows path for display
     */
    private static getWindowsPath(linuxPath: string): string {
        if (linuxPath.startsWith('/mnt/c/')) {
            return 'C:' + linuxPath.substring(6).replace(/\//g, '\\');
        }
        if (linuxPath.startsWith('/mnt/')) {
            const drive = linuxPath.substring(5, 6).toUpperCase();
            return drive + ':' + linuxPath.substring(6).replace(/\//g, '\\');
        }
        return linuxPath; // Fallback to original path
    }

    /**
     * Enhanced logging for Windows FUSE calls
     */
    private static logWindowsFuseCall(
        operation: string,
        handler: (...args2: any[]) => void,
        ...args: any[]
    ): void {
        console.log(`🐧🪟 FUSE ${operation}:`, args.slice(0, 2)); // Log first 2 args to avoid clutter
        handler(...args);
    }

    /**
     * Enhanced logging for Windows FUSE calls with callbacks
     */
    private static logWindowsFuseCallCB(
        name: string,
        handler: (...args2: any[]) => void,
        ...args: unknown[]
    ): void {
        const normalArgs = args.slice(0, -1);
        const cbArg = args[args.length - 1];

        if (!isFunction(cbArg)) {
            throw new Error(`cbArg is not a function but ${typeof cbArg}: ${String(cbArg)}`);
        }

        const path = String(normalArgs[0]);
        const route = path === '/' ? '🏠 root' : path.includes('/') ? `📁 ${path}` : `📄 ${path}`;

        console.log(`🐧🪟 FUSE ${name}: ${route}`);

        // Call with enhanced callback logging
        handler(...normalArgs, (...argscb: unknown[]) => {
            const returnedCode = parseInt(argscb[0] as string, 10);
            
            if (returnedCode !== 0) {
                console.log(`❌ FUSE ${name} failed: ${route} (code: ${returnedCode})`);
            } else if (name === 'getattr' || name === 'readdir') {
                // Log successful operations for important calls
                console.log(`✅ FUSE ${name}: ${route}`);
            }

            (cbArg as (...args: unknown[]) => void)(...argscb);
        });
    }
} 