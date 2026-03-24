import {expect} from 'chai';
import {exec} from 'child_process';

import {getInstanceIdHash} from '@refinio/one.core/lib/instance';
import {deleteStorage, listAllObjectHashes} from '@refinio/one.core/lib/system/storage-base';

import {Filer} from '../lib/Filer';

const filer = new Filer({
    directory: 'test/data',
    mountPoint: 'test/mnt',
    iomMode: 'light'
});

describe('-> Testing the objects directory', () => {
    before('before anything should initialize one.core', async () => {
        await filer.startFUSE();
    });

    it('should contain objects hashes', async () => {
        const hashes = await listAllObjectHashes();
        await new Promise((resolve, reject) => {
            exec('ls ./test/mnt/objects', (error, stdout, _stderr) => {
                if (error !== null) {
                    const err = new Error(error.message);
                    console.error(
                        `exec error: ${error.message}, ${error.code || ''}, ${error.stack || ''}`
                    );
                    return reject(err);
                }

                const content = stdout.split('\n').filter((c: string) => c !== '');
                expect(content.length).to.be.equal(hashes.length);
                resolve({});
            });
        });
    });

    after('after should close the instance and unmount FUSE', async () => {
        const instanceId = getInstanceIdHash();

        await filer.endFUSE();

        if (instanceId === undefined) {
            throw new Error('Instance ID is undefined, cannot delete storage');
        }

        await deleteStorage(instanceId);
    });
});
