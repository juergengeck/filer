/**
 * @author Sebastian Șandru <sebastian@refinio.net>
 */
import {closeInstance} from '@refinio/one.core/lib/instance.js';
import * as StorageTestInit from './_helpers.js';
import {expect} from 'chai';

import TestModel, {removeDir} from './utils/TestModel.js';
import {createFileWriteStream} from '@refinio/one.core/lib/system/storage-streams.js';
import type PersistentFileSystem from '../lib/fileSystems/PersistentFileSystem.js';
import PersistentFilerModel from '../lib/models/filer/PersistentFilerModel.js';

let fileSystem: PersistentFileSystem;
let testModel: TestModel;

const dbKey = 'testDb';

describe('FilerModel model test', () => {
    before(async () => {
        await StorageTestInit.init({dbKey: dbKey, deleteDb: false});
        const model = new TestModel('ws://localhost:8000');
        await model.init(undefined);
        testModel = model;
        const filerModel = new PersistentFilerModel(model.channelManager);
        await filerModel.init();
        fileSystem = filerModel.fileSystem;
    });

    it('should see if the root was created', async () => {
        const result = await fileSystem.readDir('/');
        expect(result).to.not.be.equal(undefined);
    });

    it.skip('should see if directories can be created and retrieved', async () => {
        await fileSystem.createDir('/dir1');
        await fileSystem.createDir('/dir1/dir2');
        await fileSystem.createDir('/dir1/dir2/dir3');
        const firstResult = await fileSystem.readDir('/');
        const secondResult = await fileSystem.readDir('/dir1');
        const thirdResult = await fileSystem.readDir('/dir1/dir2');
        expect(firstResult).to.not.be.equal(undefined);
        expect(secondResult).to.not.be.equal(undefined);
        expect(thirdResult).to.not.be.equal(undefined);

        const firstRetrieveResult = await fileSystem.readDir('/dir1/dir2/dir3');
        const secondRetrieveResult = await fileSystem.readDir('/dir1/dir2');
        const thirdRetrieveResult = await fileSystem.readDir('/dir1');
        expect(Array.from(firstRetrieveResult.children.keys()).length).to.be.equal(0);

        expect(Array.from(secondRetrieveResult.children.keys()).length).to.be.equal(1);

        expect(Array.from(thirdRetrieveResult.children.keys()).length).to.be.equal(1);

        /* does not work ...
        const dirs = [];
        for (let i = 0; i < 100; i++) {
            dirs.push(`con${i}`);
        }
        await Promise.all(
            dirs.map(async (dirName: string) => {
                const res = await fileSystem.createDir(dirName);
            })
        );
        const rootRetrieveResult = await fileSystem.readDir('/');
        expect(Array.from(rootRetrieveResult.children.keys()).length).to.be.equal(101);*/
    }).timeout(10000);

    it.skip('should see if files can be created and retrieved', async () => {
        await fileSystem.createDir('/files');
        const firstResult = fileSystem.readDir('/');
        expect(firstResult).to.not.be.equal(undefined);
        const stream = createFileWriteStream();
        stream.write(new ArrayBuffer(64));
        const blob = await stream.end();
        await fileSystem.createFile('/files', blob.hash, 'newFile.txt');
        const retrievedFileResult = await fileSystem.readFile('/files/newFile.txt');
        expect(retrievedFileResult).to.not.be.equal(undefined);
    });

    after(async () => {
        await testModel.shutdown();
        closeInstance();
        await removeDir(`./test/${dbKey}`);
    });
});
