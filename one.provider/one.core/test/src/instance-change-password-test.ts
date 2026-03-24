/*
  eslint-disable no-console,,
  @typescript-eslint/no-use-before-define,
  @typescript-eslint/no-unsafe-call
 */

import {expect} from 'chai';

import {changePassword} from '../../lib/instance-change-password.js';
import {closeInstance, getInstanceIdHash} from '../../lib/instance.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import {isBrowser, isNode} from '../../lib/system/platform.js';
import {wait} from '../../lib/util/promise.js';

import * as StorageTestInit from './_helpers.js';

const email = 'test@test.com';
const name = 'test'; // Instance name
const dbKey = 'testDb'; // node.js directory "test/testDb", browser DB name "testDb"
const initialSecret = 'password ORIG';

describe('Change password of existing instance', function changePwTests() {
    before(() => {
        startLogger({includeInstanceName: true, types: ['error']});
    });
    beforeEach(() =>
        StorageTestInit.init({
            email,
            secret: initialSecret,
            name,
            dbKey,
            encryptStorage: isBrowser,
            deleteDb: true
        })
    );
    afterEach(() => StorageTestInit.remove());
    after(() => {
        stopLogger();
    });

    it('should change the password of existing INACTIVE instance', async function test1() {
        const instanceId = getInstanceIdHash();

        if (instanceId === undefined) {
            throw new Error('Instance setup failed');
        }

        closeInstance();
        await wait(200);

        await changePassword(
            {
                name,
                email,
                directory: 'test/' + dbKey,
                encryptStorage: isBrowser,
                secret: initialSecret
            },
            'password NEW'
        );

        try {
            await StorageTestInit.init({
                email,
                secret: initialSecret,
                name,
                dbKey,
                encryptStorage: isBrowser,
                deleteDb: false
            });
            expect(false, 'Instance should not have started').to.be.true;
        } catch (err) {
            expect(err.message).to.contain(isNode ? 'CYENC-SYMDEC' : 'SC-LDENC');
        }

        closeInstance();
        await wait(200);

        await StorageTestInit.init({
            email,
            secret: 'password NEW',
            name,
            dbKey,
            encryptStorage: isBrowser,
            deleteDb: false
        });

        expect(true).to.be.true;
    });

    it('should change the password of existing ACTIVE instance', async function test2() {
        const instanceId = getInstanceIdHash();

        if (instanceId === undefined) {
            throw new Error('Instance ID is undefined');
        }

        await changePassword(
            {
                name: name,
                email: email,
                directory: isBrowser ? dbKey : 'test/' + dbKey,
                encryptStorage: isBrowser,
                secret: initialSecret
            },
            'password NEW'
        );

        closeInstance();
        await wait(200);

        try {
            await StorageTestInit.init({
                email,
                secret: initialSecret,
                name,
                dbKey,
                encryptStorage: isBrowser,
                deleteDb: false
            });
            expect(false, 'Instance should not have started').to.be.true;
        } catch (err) {
            expect(err.message).to.contain(isNode ? 'CYENC-SYMDEC' : 'SC-LDENC');
        }

        closeInstance();
        await wait(200);

        await StorageTestInit.init({
            email,
            secret: 'password NEW',
            name,
            dbKey,
            encryptStorage: isBrowser,
            deleteDb: false
        });

        expect(true).to.be.true;
    });
});
