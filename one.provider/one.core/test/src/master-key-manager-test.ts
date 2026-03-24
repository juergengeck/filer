import {expect} from 'chai';

import {closeAndDeleteCurrentInstance, initInstance} from '../../lib/instance.js';
import {MasterKeyManager} from '../../lib/keychain/master-key-manager.js';
import {startLogger, stopLogger} from '../../lib/logger.js';

describe('Test the master key manager', function cryptoTests() {
    const instanceOptions = {
        name: 'personA',
        email: 'personA',
        secret: 'personA',
        directory: 'test/testDb'
    };
    let err;

    before(async () => {
        startLogger({includeInstanceName: true, types: ['error']});
        await initInstance(instanceOptions);
    });

    after(async () => {
        await closeAndDeleteCurrentInstance();
        stopLogger();
    });

    it('change password and try decryption afterwards', async () => {
        const message = new Uint8Array([255, 0, 127, 128, 10]);

        // Create a master key encrypt and decrypt something
        const m = new MasterKeyManager('test_masterKey', 'test_salt');
        await m.loadOrCreateMasterKey('abc');

        const encryptedMessage = m.encryptDataWithMasterKey(message);
        const decryptedMessage1 = m.decryptDataWithMasterKey(encryptedMessage);
        expect(decryptedMessage1).to.deep.equal(message);

        m.unloadMasterKey();

        // Test a password change with wrong secret
        err = undefined;
        await m.changeSecret('def', 'xyz').catch(e => {
            err = e;
        });
        expect(err).not.to.be.undefined;

        // Test a password change with the correct password
        await m.changeSecret('abc', 'xyz');

        // Try to log in with old password
        err = undefined;
        await m.loadOrCreateMasterKey('abc').catch(e => {
            err = e;
        });
        expect(err).not.to.be.undefined;

        // A correct login
        await m.loadOrCreateMasterKey('xyz');

        // Decrypt old data (should have survived the password change)
        const decryptedMessage2 = m.decryptDataWithMasterKey(encryptedMessage);
        expect(decryptedMessage2).to.deep.equal(message);

        m.unloadMasterKey();
    });
});
