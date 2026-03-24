/**
 * WSL2 Filer for Windows Explorer Integration
 * 
 * This filer runs in WSL2 Debian and uses the WindowsFuseFrontend
 * to provide Windows Explorer integration with Windows file attributes,
 * extended attributes, and alternate data streams accessible via WSL2.
 * 
 * @author ONE.filer Team
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 */

import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem.js';
import {WindowsFuseFrontend} from './WindowsFuseFrontend.js';
import {createError} from '@refinio/one.core/lib/errors.js';

/**
 * WSL2 Filer for Windows Explorer Integration
 * 
 * This class provides a file system interface that runs in WSL2 Debian and integrates
 * with Windows Explorer through FUSE, supporting Windows file attributes,
 * extended attributes, and alternate data streams via the WSL2 file bridge.
 */
export class WindowsFiler {
    private windowsFuseFrontend: WindowsFuseFrontend;
    private isStarted: boolean = false;
    private currentMountPoint: string | null = null;

    constructor() {
        this.windowsFuseFrontend = new WindowsFuseFrontend();
    }

    /**
     * Start the WSL2 Filer with Windows Explorer integration
     * 
     * @param rootFileSystem - The root file system to expose
     * @param mountPoint - WSL2 mount point accessible from Windows (e.g., "/mnt/c/one-files")
     * @param logCalls - Enable detailed FUSE call logging
     */
    public async start(
        rootFileSystem: IFileSystem,
        mountPoint: string = '/mnt/c/one-files',
        logCalls: boolean = false
    ): Promise<void> {
        if (this.isStarted) {
            throw createError('FILER-ALREADY-STARTED', {
                message: 'WSL2 Windows Filer is already started',
                mountPoint: this.currentMountPoint
            });
        }

        try {
            console.log(`🐧 Starting WSL2 Filer for Windows integration...`);
            console.log(`📁 WSL2 mount point: ${mountPoint}`);
            console.log(`🪟 Windows access path: ${this.getWindowsPath(mountPoint)}`);
            console.log(`🔍 Debug logging: ${logCalls ? 'enabled' : 'disabled'}`);

            await this.windowsFuseFrontend.start(rootFileSystem, mountPoint, logCalls);
            
            this.isStarted = true;
            this.currentMountPoint = mountPoint;
            
            console.log(`✅ WSL2 Windows Filer started successfully`);
            console.log(`🪟 Access your files via Windows Explorer at: ${this.getWindowsPath(mountPoint)}`);
            console.log(`🔗 Alternative access: \\\\wsl$\\Debian${mountPoint}`);
            
        } catch (error) {
            console.error(`❌ Failed to start WSL2 Windows Filer:`, error);
            throw createError('FILER-START-ERROR', {
                message: 'Failed to start WSL2 Windows Filer',
                mountPoint,
                originalError: error
            });
        }
    }

    /**
     * Stop the WSL2 Windows Filer
     */
    public async stop(): Promise<void> {
        if (!this.isStarted) {
            throw createError('FILER-NOT-STARTED', {
                message: 'WSL2 Windows Filer is not started'
            });
        }

        try {
            await this.windowsFuseFrontend.stop();
            this.isStarted = false;
            this.currentMountPoint = null;
            console.log(`✅ WSL2 Windows Filer stopped successfully`);
        } catch (error) {
            console.error(`❌ Failed to stop WSL2 Windows Filer:`, error);
            throw createError('FILER-STOP-ERROR', {
                message: 'Failed to stop WSL2 Windows Filer',
                originalError: error
            });
        }
    }

    /**
     * Get the current status of the WSL2 Windows Filer
     */
    public getStatus(): {
        isStarted: boolean;
        mountPoint: string | null;
        windowsPath: string | null;
    } {
        return {
            isStarted: this.isStarted,
            mountPoint: this.currentMountPoint,
            windowsPath: this.currentMountPoint ? this.getWindowsPath(this.currentMountPoint) : null
        };
    }

    /**
     * Convert WSL2 Linux mount point to Windows path for display
     */
    private getWindowsPath(linuxPath: string): string {
        if (linuxPath.startsWith('/mnt/c/')) {
            return 'C:' + linuxPath.substring(6).replace(/\//g, '\\');
        }
        if (linuxPath.startsWith('/mnt/')) {
            const drive = linuxPath.substring(5, 6).toUpperCase();
            return drive + ':' + linuxPath.substring(6).replace(/\//g, '\\');
        }
        return linuxPath; // Fallback to original path
    }
}

// ############### Convenience exports for WSL2 usage ###############

/**
 * Default WSL2 Windows Filer instance for convenience
 */
export const windowsFiler = new WindowsFiler();

/**
 * Start the WSL2 Windows Filer with default configuration
 * 
 * @param rootFileSystem - The root file system to mount
 * @param mountPoint - WSL2 mount point (default: "/mnt/c/one-files")
 * @param logCalls - Enable debug logging (default: false)
 * @returns Promise that resolves to the started WindowsFiler instance
 */
export async function startWindowsFiler(
    rootFileSystem: IFileSystem,
    mountPoint: string = '/mnt/c/one-files',
    logCalls: boolean = false
): Promise<WindowsFiler> {
    const filer = new WindowsFiler();
    await filer.start(rootFileSystem, mountPoint, logCalls);
    return filer;
}

/**
 * Stop a WSL2 Windows Filer instance
 * 
 * @param filer - The WindowsFiler instance to stop
 */
export async function stopWindowsFiler(filer: WindowsFiler): Promise<void> {
    await filer.stop();
} 