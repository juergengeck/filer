/* eslint-disable no-await-in-loop */

import * as fs from 'fs';

import {getInstanceIdHash} from '@refinio/one.core/lib/instance';
import {deleteStorage, setBaseDirOrName} from '@refinio/one.core/lib/system/storage-base';

import {Filer} from '../lib/Filer';

const testConfig = {
    directory: 'test/data',
    interactive: false,
    mountPoint: 'test/mnt',
    iomMode: 'light'
} as const;

const filer = new Filer(testConfig);

// function createDummyJsonFile(name: string, cb: NoParamCallback): void {
//     try {
//         const dummy = `File with name : ${name}`;
//         fs.writeFile(`test/testData/${name}`, dummy, err => {
//             cb(err);
//         });
//     } catch (e) {
//         console.log(e);
//     }
// }

// function generateFilesNameForTxt(howMany: number, format: string): string[] {
//     const fileNames = [];
//
//     for (let i = 0; i < howMany; i++) {
//         fileNames.push(`${i}${format}`);
//     }
//
//     return fileNames;
// }

describe('-> Testing the files directory', () => {
    before('before anything should initialize one.core', async () => {
        setBaseDirOrName(testConfig.directory);
        await filer.startFUSE();
        await new Promise((resolve, _) => {
            fs.stat('test/testData', async (err, _res) => {
                if (err) {
                    await new Promise((resolveMkdir, rejectMkdir) => {
                        fs.mkdir('test/testData', errMkdir => {
                            if (errMkdir) {
                                return rejectMkdir(new Error(errMkdir.toString()));
                            }
                            resolveMkdir({});
                        });
                    });
                    resolve({});
                }
                resolve({});
            });
        });
    });

    // it('should copy a hardcoded number of files to mnt/files and see if they exists', async ()
    // => { const howMany = 25; const fileNames = generateFilesNameForTxt(howMany, '.txt');  for
    // (const fileName of fileNames) { await new Promise((r, re) => { createDummyJsonFile(fileName,
    // err => { if (err) { throw new Error(err.toString()); }  const cmd = `cp
    // test/testData/${fileName} test/mnt/files/media`; new Promise((resolve, reject) => {
    // exec(cmd, errExec => { if (errExec) { reject(errExec); } resolve({}); }); }) .then(_ =>
    // r({})) .catch(errExec => re(String(errExec))); }); }); }  const contents = await
    // filer.model.persistentFilerModel.fileSystem.readDir('/'); const hasMediaFolder =
    // contents.children.find((folder: string) => folder === 'media');
    // expect(hasMediaFolder).to.not.be.equal(undefined);  const mediaContents = await
    // filer.model.persistentFilerModel.fileSystem.readDir('/media');
    // expect(mediaContents.children.length).to.be.equal(howMany); }).timeout(40000);

    after('after should close the instance and unmount FUSE', async () => {
        await filer.endFUSE();

        const instanceId = getInstanceIdHash();

        if (instanceId === undefined) {
            throw new Error('Instance ID is undefined, cannot delete storage');
        }

        await deleteStorage(instanceId);
    });
});
