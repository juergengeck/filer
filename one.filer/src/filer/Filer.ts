import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem';

import {COMMIT_HASH} from '../commit-hash';
import {DefaultFilerConfig} from './FilerConfig';
import type {FilerConfig} from './FilerConfig';

import {FuseFrontend} from './FuseFrontend';
import {createLegacyRootFileSystem} from './createLegacyRootFileSystem';
import type {LegacyFilerModels} from './createLegacyRootFileSystem';
import {fillMissingWithDefaults} from '../misc/configHelper';

export type FilerModels = LegacyFilerModels;

/**
 * This class represents the main starting point for `one.filer`
 *
 * It has a default composition of file systems. See setupRootFileSystem for details.
 */
export class Filer {
    private readonly models: FilerModels;
    private readonly config: FilerConfig;
    private shutdownFunctions: Array<() => Promise<void>> = [];

    constructor(models: FilerModels, config: Partial<FilerConfig>) {
        this.config = fillMissingWithDefaults(config, DefaultFilerConfig);
        this.models = models;
    }

    /**
     * Init the filer by setting up file systems and mounting fuse.
     */
    async init(): Promise<void> {
        // Ensure we're running in Node.js environment (WSL2 Debian with Node.js)
        if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
            throw new Error('Fuse can only be mounted in Node.js environment');
        }

        const rootFileSystem = await this.setupRootFileSystem();

        const fuseFrontend = new FuseFrontend();
        await fuseFrontend.start(rootFileSystem, this.config.mountPoint, this.config.logCalls);
        this.shutdownFunctions.push(fuseFrontend.stop.bind(fuseFrontend));

        console.log(
            `[info]: Filer file system was mounted at ${this.config.mountPoint}`
        );
    }

    /**
     * Shutdown filer.
     */
    async shutdown(): Promise<void> {
        for await (const fn of this.shutdownFunctions) {
            try {
                await fn();
            } catch (e) {
                console.error('Failed to exscute shutdown routine', e);
            }
        }
        this.shutdownFunctions = [];
    }

    /**
     * Set up the root filesystem by mounting all wanted filesystems.
     */
    private async setupRootFileSystem(): Promise<IFileSystem> {
        return createLegacyRootFileSystem(this.models, {
            commitHash: COMMIT_HASH,
            iomMode: this.config.iomMode,
            pairingUrl: this.config.pairingUrl
        });
    }
}
