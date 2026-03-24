/**
 * Windows Explorer Integration Example
 * 
 * This example demonstrates how to set up the Windows Filer to integrate
 * ONE objects with Windows Explorer through FUSE mounting.
 * 
 * @author ONE.filer Team
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 */

import {WindowsFiler} from '../filer/WindowsFiler.js';
import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem.js';

/**
 * Example configuration for Windows Explorer integration
 */
export interface WindowsExplorerConfig {
    /** Mount point for Windows Explorer (e.g., "Z:" or "C:\\one-files") */
    mountPoint: string;
    
    /** Enable detailed FUSE call logging for debugging */
    enableLogging: boolean;
    
    /** Root file system to expose */
    rootFileSystem: IFileSystem;
}

/**
 * Set up Windows Explorer integration with ONE objects
 * 
 * This function configures and starts the Windows Filer to make ONE objects
 * accessible through Windows Explorer with full Windows file attribute support.
 * 
 * @param config - Configuration for Windows Explorer integration
 * @returns Promise that resolves to the started WindowsFiler instance
 */
export async function setupWindowsExplorerIntegration(
    config: WindowsExplorerConfig
): Promise<WindowsFiler> {
    console.log('🪟 Setting up Windows Explorer integration...');
    console.log(`📁 Mount point: ${config.mountPoint}`);
    console.log(`🔍 Logging: ${config.enableLogging ? 'enabled' : 'disabled'}`);

    // Validate platform
    if (process.platform !== 'win32') {
        throw new Error('Windows Explorer integration is only available on Windows');
    }

    // Create and start Windows Filer
    const windowsFiler = new WindowsFiler();
    
    try {
        await windowsFiler.start(
            config.rootFileSystem,
            config.mountPoint,
            config.enableLogging
        );

        console.log('✅ Windows Explorer integration setup complete!');
        console.log(`🪟 Your ONE objects are now accessible at: ${config.mountPoint}`);
        console.log('📂 Open Windows Explorer and navigate to the mount point to access your files');
        
        return windowsFiler;
        
    } catch (error) {
        console.error('❌ Failed to setup Windows Explorer integration:', error);
        throw error;
    }
}

/**
 * Example usage with default configuration
 */
export async function startDefaultWindowsIntegration(
    rootFileSystem: IFileSystem
): Promise<WindowsFiler> {
    const config: WindowsExplorerConfig = {
        mountPoint: 'Z:', // Mount as Z: drive
        enableLogging: false, // Disable logging for production
        rootFileSystem
    };

    return setupWindowsExplorerIntegration(config);
}

/**
 * Example usage with custom directory mount point
 */
export async function startCustomDirectoryIntegration(
    rootFileSystem: IFileSystem,
    customPath: string = 'C:\\ONE-Files'
): Promise<WindowsFiler> {
    const config: WindowsExplorerConfig = {
        mountPoint: customPath,
        enableLogging: true, // Enable logging for debugging
        rootFileSystem
    };

    return setupWindowsExplorerIntegration(config);
}

/**
 * Gracefully stop Windows Explorer integration
 */
export async function stopWindowsExplorerIntegration(
    windowsFiler: WindowsFiler
): Promise<void> {
    console.log('🪟 Stopping Windows Explorer integration...');
    
    try {
        await windowsFiler.stop();
        console.log('✅ Windows Explorer integration stopped successfully');
    } catch (error) {
        console.error('❌ Error stopping Windows Explorer integration:', error);
        throw error;
    }
}

/**
 * Example of a complete Windows Explorer integration lifecycle
 */
export async function exampleWindowsIntegrationLifecycle(
    rootFileSystem: IFileSystem
): Promise<void> {
    let windowsFiler: WindowsFiler | null = null;

    try {
        // Start integration
        windowsFiler = await startDefaultWindowsIntegration(rootFileSystem);
        
        // Log status
        const status = windowsFiler.getStatus();
        console.log('📊 Windows Filer Status:', status);
        
        // Keep running for demonstration (in real usage, this would run indefinitely)
        console.log('🔄 Windows Explorer integration is running...');
        console.log('💡 Press Ctrl+C to stop');
        
        // Set up graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Received shutdown signal...');
            if (windowsFiler) {
                await stopWindowsExplorerIntegration(windowsFiler);
            }
            process.exit(0);
        });
        
        // Keep the process alive
        await new Promise(() => {}); // Run indefinitely
        
    } catch (error) {
        console.error('❌ Windows integration example failed:', error);
        
        if (windowsFiler) {
            try {
                await stopWindowsExplorerIntegration(windowsFiler);
            } catch (stopError) {
                console.error('❌ Error during cleanup:', stopError);
            }
        }
        
        throw error;
    }
} 