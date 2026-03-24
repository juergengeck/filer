import {expect} from 'chai';

import {createRandomNonce} from '../../lib/crypto/encryption.js';
import {
    closeAndDeleteCurrentInstance,
    getInstanceIdHash,
    getInstanceOwnerIdHash,
    initInstance
} from '../../lib/instance.js';
import {getPublicKeys} from '../../lib/keychain/key-storage-public.js';
import {
    changeKeyChainSecret,
    createCryptoApiFromDefaultKeys,
    createDefaultKeys,
    getDefaultKeys,
    getDefaultSecretKeysAsBase64,
    hasDefaultKeys,
    lockKeyChain,
    unlockOrCreateKeyChain
} from '../../lib/keychain/keychain.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import {storeVersionedObject} from '../../lib/storage-versioned-objects.js';

describe('Default keys keychain unlock test', function cryptoTests() {
    const instanceAOptions = {
        name: 'personA',
        email: 'personA',
        secret: 'personA',
        directory: 'test/testDb'
    };

    before(async () => {
        startLogger({includeInstanceName: true, types: ['error']});
        await initInstance(instanceAOptions);
    });

    after(async () => {
        await closeAndDeleteCurrentInstance();
        stopLogger();
    });

    it('check owner keys', async () => {
        const owner = getInstanceOwnerIdHash();
        const instance = getInstanceIdHash();

        if (owner === undefined) {
            throw new Error('Instance owner is not initialized');
        }

        if (instance === undefined) {
            throw new Error('Instance is not initialized');
        }

        const hasOwnerDefaultKeys = await hasDefaultKeys(owner);
        const hasInstanceDefaultKeys = await hasDefaultKeys(instance);
        expect(hasOwnerDefaultKeys).to.be.equal(true);
        expect(hasInstanceDefaultKeys).to.be.equal(true);

        await getDefaultKeys(owner);
        await getDefaultKeys(instance);
    });

    it('should get owner default secret keys as base64 string', async () => {
        const owner = getInstanceOwnerIdHash();

        if (owner === undefined) {
            throw new Error('Instance owner is not initialized');
        }

        const secretKeys = await getDefaultSecretKeysAsBase64(owner);

        expect(secretKeys.secretEncryptionKey).to.be.a('string');
        expect(secretKeys.secretEncryptionKey.length).to.equal(44);
        expect(secretKeys.secretEncryptionKey).to.match(
            /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/
        );

        expect(secretKeys.secretSignKey).to.be.a('string');
        expect(secretKeys.secretSignKey.length).to.equal(88);
        expect(secretKeys.secretSignKey).to.match(
            /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/
        );
    });

    it('create keys and exchange encrypted messages', async () => {
        const person1Result = await storeVersionedObject({
            $type$: 'Person',
            email: 'p1'
        });
        const person2Result = await storeVersionedObject({
            $type$: 'Person',
            email: 'p2'
        });

        const hasPerson1DefaultKeysBefore = await hasDefaultKeys(person1Result.idHash);
        const hasPerson2DefaultKeysBefore = await hasDefaultKeys(person2Result.idHash);
        expect(hasPerson1DefaultKeysBefore).to.be.equal(false);
        expect(hasPerson2DefaultKeysBefore).to.be.equal(false);

        const person1Keys = await getPublicKeys(await createDefaultKeys(person1Result.idHash));
        const person2Keys = await getPublicKeys(await createDefaultKeys(person2Result.idHash));

        const hasPerson1DefaultKeysAfter = await hasDefaultKeys(person1Result.idHash);
        const hasPerson2DefaultKeysAfter = await hasDefaultKeys(person2Result.idHash);
        expect(hasPerson1DefaultKeysAfter).to.be.equal(true);
        expect(hasPerson2DefaultKeysAfter).to.be.equal(true);

        const person1CryptoApi = await createCryptoApiFromDefaultKeys(person1Result.idHash);
        const person2CryptoApi = await createCryptoApiFromDefaultKeys(person2Result.idHash);

        const api1 = person1CryptoApi.createEncryptionApiWithPerson(
            person2Keys.publicEncryptionKey
        );
        const api2 = person2CryptoApi.createEncryptionApiWithPerson(
            person1Keys.publicEncryptionKey
        );

        const value1 = new Uint8Array([0, 2, 4]);
        const cypherAndNonce = api1.encryptAndEmbedNonce(value1);
        const result1 = api2.decryptWithEmbeddedNonce(cypherAndNonce);
        expect(value1).to.deep.equal(result1);

        const value2 = new Uint8Array([1, 3, 5]);
        const nonce = createRandomNonce();
        const cypher = api2.encrypt(value2, nonce);
        const result2 = api1.decrypt(cypher, nonce);
        expect(value2).to.deep.equal(result2);
    });

    it('change password', async () => {
        await changeKeyChainSecret(instanceAOptions.secret, 'newPW');
        lockKeyChain();

        let error;

        try {
            await unlockOrCreateKeyChain(instanceAOptions.secret);
        } catch (e) {
            error = e;
        }
        expect(error).not.to.be.undefined;
        await unlockOrCreateKeyChain('newPW');
    });
});
