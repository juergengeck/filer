import type {Stats} from 'fs';
import * as fs from 'fs';
import {exec} from 'child_process';
import {expect} from 'chai';

import {getInstanceIdHash} from '@refinio/one.core/lib/instance';
import {deleteStorage} from '@refinio/one.core/lib/system/storage-base';

import {Filer} from '../lib/Filer';

const testConfig = {
    directory: 'test/data',
    interactive: false,
    mountPoint: 'test/mnt',
    iomMode: 'light'
} as const;

const filer = new Filer(testConfig);

describe('-> Testing the connections directory', () => {
    before('before anything should initialize one.core', async () => {
        await filer.startFUSE();
    });

    it('should contain 2 folders named Import & Export and 1 txt file named connection_details.txt', async () => {
        const connectionsList = await new Promise<string[]>((resolve, _reject) => {
            exec('ls test/mnt/connections', (error, stdout, _stderr) => {
                if (error) {
                    throw new Error(error.message);
                }

                const content = stdout.split('\n').filter(c => c !== '');
                expect(content.length).to.be.equal(3);
                resolve(content);
            });
        });

        const connectionDetailsStats: Stats = await new Promise((resolve, _reject) => {
            const connDetails = connectionsList.find(name => name === 'connections_details.txt');

            if (connDetails === undefined) {
                throw new Error('Connection not found');
            }

            fs.stat(`${testConfig.mountPoint}/connections/${connDetails}`, (err, stats: Stats) => {
                if (err) {
                    throw new Error(err.toString());
                }
                resolve(stats);
            });
        });
        expect(connectionDetailsStats.isFile()).to.be.equal(true);

        const importStats: Stats = await new Promise((resolve, _reject) => {
            const connImport = connectionsList.find(name => name === 'import');

            if (connImport === undefined) {
                throw new Error('Connection not found');
            }

            fs.stat(`${testConfig.mountPoint}/connections/${connImport}`, (err, stats: Stats) => {
                if (err) {
                    throw new Error(err.toString());
                }
                resolve(stats);
            });
        });
        expect(importStats.isDirectory()).to.be.equal(true);

        const exportStats: Stats = await new Promise((resolve, _reject) => {
            const connExport = connectionsList.find(name => name === 'export');

            if (connExport === undefined) {
                throw new Error('Connection not found');
            }

            fs.stat(`${testConfig.mountPoint}/connections/${connExport}`, (err, stats: Stats) => {
                if (err) {
                    throw new Error(err.toString());
                }
                resolve(stats);
            });
        });
        expect(exportStats.isDirectory()).to.be.equal(true);
    });

    it('should see if connections/export directory has one png', async () => {
        const contents: string[] = await new Promise((resolve, _reject) => {
            exec('ls test/mnt/connections/export', (error, stdout, _stderr) => {
                if (error) {
                    throw new Error(error.message);
                }

                const content = stdout.split('\n').filter((c: string) => c !== '');
                expect(content.length).to.be.equal(1);
                resolve(content);
            });
        });
        const qrCodePngStats: Stats = await new Promise((resolve, _reject) => {
            fs.stat(
                `${testConfig.mountPoint}/connections/export/${contents[0]}`,
                (err, stats: Stats) => {
                    if (err) {
                        throw new Error(err.message);
                    }
                    resolve(stats);
                }
            );
        });
        expect(qrCodePngStats.isFile()).to.be.equal(true);
        expect(contents[0].includes('.png')).to.be.equal(true);
    });

    after('after should close the instance and unmount FUSE', async () => {
        await filer.endFUSE();

        const instanceId = getInstanceIdHash();

        if (instanceId === undefined) {
            throw new Error('Instance ID is undefined, cannot delete storage');
        }

        await deleteStorage(instanceId);
    });
});
