import {expect} from 'chai';

import type {InstanceOptions} from '../../lib/instance.js';
import {
    calculateInstanceIdHash,
    closeAndDeleteCurrentInstance,
    closeInstance,
    deleteInstance,
    getInstanceIdHash,
    initInstance,
    instanceExists
} from '../../lib/instance.js';
import {SYSTEM} from '../../lib/system/platform.js';
import {setBaseDirOrName} from '../../lib/system/storage-base.js';
import {wait} from '../../lib/util/promise.js';

import * as StorageTestInit from './_helpers.js';
import {RECIPES} from './_register-types.js';
import {isObject} from '../../lib/util/type-checks-basic.js';

const instanceOptions: InstanceOptions = {
    name: 'instance-function-tests',
    email: 'ownerEmail',
    secret: 'ownerSecret',
    wipeStorage: false,
    encryptStorage: false,
    directory: 'test/testDb', // need to use the same directory as in the other tests
    initialRecipes: []
};

describe('Instance tests', async () => {
    before(async () => {
        await import(`../../lib/system/load-${SYSTEM}.js`);
        setBaseDirOrName(instanceOptions.directory);
        await StorageTestInit.remove();
    });

    after(() => StorageTestInit.remove());

    it('should FAIL to find the instance', async () => {
        const exists = await instanceExists(instanceOptions.name, instanceOptions.email);
        expect(exists).to.be.false;
    });

    it('should FAIL to delete the instance', async () => {
        try {
            await deleteInstance(instanceOptions.name, instanceOptions.email);
        } catch (err) {
            if (!isObject(err) || err.code !== 'IN-DI1') {
                throw err;
            }
        }
    });

    it('should throw SB-SETDIR if the same app/test-run tries to set a different Base directory', async function test() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(12000);

        await initInstance(instanceOptions);
        await closeAndDeleteCurrentInstance();

        try {
            const directory = 'instance-test-folder';
            await initInstance({...instanceOptions, directory});
        } catch (err) {
            if (!isObject(err) || err.code !== 'SB-SETDIR') {
                throw err;
            }
        }

        try {
            await closeAndDeleteCurrentInstance();
            expect(false).to.be.true;
        } catch (err) {
            expect(err.code).to.equal('IN-CADCI1');
        }
    });

    it('should check if the instance exists', async () => {
        await initInstance(instanceOptions);

        const exists = await instanceExists(instanceOptions.name, instanceOptions.email);
        expect(exists).to.be.true;
        await closeAndDeleteCurrentInstance();
    });

    it('should delete the instance', async () => {
        const exists = await instanceExists(instanceOptions.name, instanceOptions.email);
        expect(exists).to.be.false;
        await initInstance(instanceOptions);

        const exists2 = await instanceExists(instanceOptions.name, instanceOptions.email);
        expect(exists2).to.be.true;

        await deleteInstance(instanceOptions.name, instanceOptions.email);

        const exists3 = await instanceExists(instanceOptions.name, instanceOptions.email);
        expect(exists3).to.be.false;

        closeInstance();
    });

    it('should calculate the same instanceId hash as initInstance', async () => {
        // -------------------- Important -------------------
        // - if this test fails maybe the microdata changed -
        // --------------------------------------------------
        const calculatedInstanceIdHash = await calculateInstanceIdHash(
            instanceOptions.name,
            instanceOptions.email
        );

        await initInstance(instanceOptions);

        const instanceIdHash = getInstanceIdHash();

        expect(calculatedInstanceIdHash).to.equal(instanceIdHash);

        await closeAndDeleteCurrentInstance();
    });

    it('should initialize an instance with duplicated recipes', async () => {
        // Duplicated recipes lead to an error because storeVersionedObject was not
        // "transaction-safe" and creating the same object at the same time lead to version map
        // updater being called with creation status "exists", but no version map for that first
        // creation had run yet. So for a few milliseconds there was an undefined state -
        // because whenever creation status is "exists" there MUST already be a version map.
        // Except for right within the not-a-transaction creation of the very first object under
        // an ID hash.
        try {
            await initInstance(
                Object.assign({}, instanceOptions, {initialRecipes: [...RECIPES, ...RECIPES]})
            );
        } catch (err) {
            await wait(250);
            await StorageTestInit.remove(instanceOptions.name, instanceOptions.email);
            throw err;
        }

        const exists = await instanceExists(instanceOptions.name, instanceOptions.email);
        expect(exists).to.be.true;

        await closeAndDeleteCurrentInstance();
    });
});
