import {expect} from 'chai';

import {ensurePublicKey, ensureSecretKey} from '../../lib/crypto/encryption.js';
import {ensurePublicSignKey, ensureSecretSignKey} from '../../lib/crypto/sign.js';
import {updateInstance} from '../../lib/instance-updater.js';
import {
    closeAndDeleteCurrentInstance,
    closeInstance,
    getInstanceOwnerIdHash,
    initInstance
} from '../../lib/instance.js';
import {createCryptoApiFromDefaultKeys} from '../../lib/keychain/keychain.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import * as ObjectRecipes from '../../lib/object-recipes.js';
import type {BLOB, PersonId, Recipe, VersionNodeChange} from '../../lib/recipes.js';
import {
    readBlobAsArrayBuffer,
    readBlobAsBase64,
    storeArrayBufferAsBlob,
    storeBase64StringAsBlob
} from '../../lib/storage-blob.js';
import {getIdHash} from '../../lib/storage-id-hash-cache.js';
import type {UnversionedObjectResult} from '../../lib/storage-unversioned-objects.js';
import {
    getObject,
    getObjectWithType,
    storeUnversionedObject
} from '../../lib/storage-unversioned-objects.js';
import type {VersionedObjectResult} from '../../lib/storage-versioned-objects.js';
import {
    getIdObject,
    getObjectByIdHash,
    getObjectByIdObj,
    storeIdObject,
    storeVersionedObject
} from '../../lib/storage-versioned-objects.js';
import {createCryptoHash, createRandomString} from '../../lib/system/crypto-helpers.js';
import {isBrowser, isNode} from '../../lib/system/platform.js';
import {
    getFileType,
    initStorage,
    listAllIdHashes,
    listAllObjectHashes
} from '../../lib/system/storage-base.js';
import {createFileWriteStream} from '../../lib/system/storage-streams.js';
import {hexToUint8ArrayWithCheck} from '../../lib/util/arraybuffer-to-and-from-hex-string.js';
import {calculateHashOfObj, calculateIdHashOfObj} from '../../lib/util/object.js';
import type {SHA256Hash} from '../../lib/util/type-checks.js';
import {isHash} from '../../lib/util/type-checks.js';
import {getCurrentVersionNode} from '../../lib/storage-versioned-objects.js';
import {convertObjToMicrodata} from '../../lib/object-to-microdata.js';

import type {StorageHelpersInitOpts} from './_helpers.js';
import * as StorageTestInit from './_helpers.js';
import type {OneTest$Email, OneTest$KeyValueMap, OneTest$ReferenceTest} from './_register-types.js';
import {RECIPES as TEST_RECIPES} from './_register-types.js';

function areArrayBuffersEqual(buf1: ArrayBuffer, buf2: ArrayBuffer): boolean {
    if (buf1.byteLength !== buf2.byteLength) {
        return false;
    }

    const dv1 = new Int8Array(buf1);
    const dv2 = new Int8Array(buf2);

    for (let i = 0; i !== buf1.byteLength; i++) {
        if (dv1[i] !== dv2[i]) {
            return false;
        }
    }

    return true;
}

describe('Storage base test', () => {
    before(async () => {
        startLogger({types: ['error']});
        await StorageTestInit.init();
    });

    after(async () => {
        await StorageTestInit.remove();
        stopLogger();
    });

    it('should create FIRST-RUN bootstrap files', async () => {
        const ownerId: PersonId = {
            $type$: 'Person',
            email: 'test@test.com'
        };

        // 3 objects for Person (includes version map)
        const ownerIdHash = await calculateIdHashOfObj(ownerId);

        // 3 objects for Instance (includes version map)
        const instanceIdHash = await calculateIdHashOfObj({
            $type$: 'Instance',
            owner: ownerIdHash,
            name: 'test'
        });

        // const allStartupFiles = await StorageBase.listAllObjectHashes();
        // const actualObjects = new Map(
        //     (
        //         await Promise.all(
        //             allStartupFiles.map(file =>
        //                 StorageBase.readUTF8TextFile(file)
        //             )
        //         )
        //     )
        //     .map((obj, index) => [allStartupFiles[index], obj])
        // );

        const instanceObjVersionMap = await getCurrentVersionNode(instanceIdHash);
        const ownerResult = await getObjectByIdHash(ownerIdHash);

        const instanceObj = await getObjectWithType(instanceObjVersionMap.obj.data, 'Instance');
        expect(instanceObj.name).to.equal('test');
        expect(instanceObj.owner).to.equal(ownerIdHash);
        expect(instanceObj.$type$).to.equal('Instance');

        // expect(instanceObj.publicKey).to.match(/^[A-Za-z0-9+/]{43}=$/);
        // expect(instanceObj.secretKey).to.match(/^[A-Za-z0-9+/]{43}=$/);
        // expect(instanceObj.publicSignKey).to.match(/^[A-Za-z0-9+/]{43}=$/);
        // expect(instanceObj.secretSignKey).to.match(/^[A-Za-z0-9+/]{86}==$/);

        const instanceTimestamp = instanceObjVersionMap.obj.creationTime;
        expect(typeof instanceTimestamp).to.equal('number');

        expect(instanceObjVersionMap.obj.$type$).to.equal('VersionNodeEdge');
        expect(instanceObjVersionMap.obj.data).to.equal(
            await calculateHashOfObj({
                $type$: 'Instance',
                name: 'test',
                owner: ownerIdHash,
                recipe: new Set(),
                enabledReverseMapTypes: new Map([
                    ['OneTest$Email', new Set(['*'])],
                    ['OneTest$ReferenceTest', new Set(['*'])],
                    ['OneTest$VersionedReferenceTest', new Set(['*'])]
                ]),
                enabledReverseMapTypesForIdObjects: new Map([
                    ['OneTest$VersionedReferenceTestAllId', new Set(['*'])]
                ])
            })
        );

        expect(ownerResult.obj).to.deep.equal({
            $type$: 'Person',
            email: 'test@test.com'
        });

        let idCount = 0;

        await Promise.all(
            (await listAllIdHashes()).map(async id => {
                idCount += 1;

                const result = await getObjectByIdHash(id);

                switch (result.obj.$type$) {
                    case 'Instance':
                        expect(result.idHash).to.equal(instanceIdHash);
                        break;
                    case 'Person':
                        expect(result.idHash).to.equal(ownerResult.idHash);
                        break;
                }
            })
        );

        expect(idCount).to.equal(2);
    });

    // ======================================================================================
    // UNVERSIONED TESTS
    // ======================================================================================

    it('should detect file types of the startup files', async () => {
        const files = await listAllObjectHashes();
        const types = await Promise.all(files.map(getFileType));
        expect(types.sort()).to.deep.equal(
            [
                'Instance [ID]',
                'Person [ID]',
                'Instance',
                'Keys',
                'Keys',
                'Person',
                'VersionNodeEdge',
                'VersionNodeEdge'
            ].sort()
        );
    });

    async function createTestObjects(): Promise<
        [
            UnversionedObjectResult<OneTest$KeyValueMap>,
            VersionedObjectResult<OneTest$Email>,
            UnversionedObjectResult<OneTest$ReferenceTest>
        ]
    > {
        // BLOB AS STREAM
        const blobStream = createFileWriteStream();

        blobStream.promise.catch((err: any) => console.log(err));

        // LENGTH IS CHECKED SO MUST BE THIS: 16*64*1002
        for (let i = 0; i < 16; i++) {
            const uint8Array = new Uint8Array(64 * 1002); // ca. 1 MB - but not exactly

            for (let j = 0; j < uint8Array.byteLength; j++) {
                uint8Array[j] = Math.floor(Math.random() * 255) + 1;
            }

            blobStream.write(uint8Array.buffer);
        }

        const blobResult = await blobStream.end();

        // BLOB AS ArrayBuffer
        const uint8Array2 = new Uint8Array(4096);

        for (let j = 0; j < uint8Array2.byteLength; j++) {
            uint8Array2[j] = j % 256;
        }

        const blobResult2 = await storeArrayBufferAsBlob(uint8Array2.buffer);

        // BLOB AS Base64
        const blob2AsBase64Result = await storeBase64StringAsBlob(
            await readBlobAsBase64(blobResult2.hash)
        );

        const referencesResult = await storeUnversionedObject({
            $type$: 'OneTest$ReferenceTest',
            blob: [
                blobResult.hash, // stream
                blobResult2.hash, // ArrayBuffer
                blob2AsBase64Result.hash // Base64
            ]
        });

        const unversionedResult = await storeUnversionedObject({
            $type$: 'OneTest$KeyValueMap',
            name: 'test 1 Obj',
            keyJsType: 'number',
            valueJsType: 'string',
            item: [
                {
                    key: '42',
                    value: ['The answer to everything']
                }
            ]
        });

        const person1Result = await storeVersionedObject({
            $type$: 'Person',
            email: 'winfried@mail.com'
        });

        const person2Result = await storeVersionedObject({
            $type$: 'Person',
            email: 'manfred@nowhere.org'
        });

        const versionedResult = await storeVersionedObject({
            $type$: 'OneTest$Email',
            messageID: 'dummy-123.123@dummy.com',
            from: [person1Result.idHash],
            to: [person1Result.idHash, person2Result.idHash],
            subject: 'Zwei Anhänge',
            date: 1438418318001,
            attachment: [blobResult.hash]
        });

        return Promise.all([unversionedResult, versionedResult, referencesResult]);
    }

    it('should store various objects', async () => {
        const planResults = await createTestObjects();
        expect(planResults.length).to.equal(3);

        // CHECK THE BLOBS (only)
        const [, , refTest] = planResults;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const [bStream, bBuffer, bBase64] = refTest.obj.blob as Array<SHA256Hash<BLOB>>;

        // The stream was created using random numbers, so we only check the length
        const bStreamReadAsBuffer = await readBlobAsArrayBuffer(bStream);
        expect(bStreamReadAsBuffer.byteLength).to.equal(16 * 64 * 1002);

        // MUST BE THE SAME AS THE ArrayBuffer CREATED BY THE TESTED MODULE
        const origArrBuffer = new Uint8Array(4096);

        for (let j = 0; j < origArrBuffer.byteLength; j++) {
            origArrBuffer[j] = j % 256;
        }

        expect(areArrayBuffersEqual(origArrBuffer.buffer, await readBlobAsArrayBuffer(bBuffer))).to
            .be.true;

        expect(areArrayBuffersEqual(origArrBuffer.buffer, await readBlobAsArrayBuffer(bBase64))).to
            .be.true;
    });

    it('should store and then get ID "IdAccess" object ', async () => {
        const personObject = await storeVersionedObject({$type$: 'Person', email: '123'});

        const idObject = await storeIdObject({
            $type$: 'IdAccess',
            id: personObject.idHash
        });

        const desiredObject = await getIdObject(idObject.idHash);

        expect(desiredObject).to.deep.equal({
            $type$: 'IdAccess',
            id: personObject.idHash
        });
    });

    it('should FAIL to store a versioned object unversioned', async () => {
        try {
            await storeUnversionedObject({
                // @ts-ignore - versioned obj. type is wrong - INTENTIONAL
                $type$: 'Person',
                email: 'winfried@mail.com'
            });
        } catch (err) {
            expect(err).to.be.instanceof(Error);
            expect(err.message).to.include('Object type is versioned');
            expect(err.message).to.include('"$type$":"Person"');
        }
    });

    it('should FAIL to store an unversioned object versioned', async () => {
        try {
            await storeVersionedObject({
                // @ts-ignore - unversioned obj. type is wrong - INTENTIONAL
                $type$: 'OneTest$KeyValueMap',
                name: 'test 1 Obj',
                keyJsType: 'number',
                valueJsType: 'string',
                item: [
                    {
                        key: 42,
                        value: ['The answer to everything']
                    }
                ]
            });
        } catch (err) {
            expect(err).to.be.instanceof(Error);
            expect(err.message).to.include(
                'SVO-SO2: The given object is not a versioned object type.'
            );
        }
    });

    it('should FAIL to load a non-existing object', async () => {
        expect(
            await getObject('INVALID HASH' as SHA256Hash<any>).catch((err: any) => ({
                isFileNotFoundError: err.name === 'FileNotFoundError'
            }))
        ).to.deep.equal({isFileNotFoundError: true});
    });

    // ======================================================================================
    // VERSIONED TESTS
    // ======================================================================================

    it('should load versioned object by ID object', async () => {
        const [, emailCreationResult] = await createTestObjects();
        const email = await getObjectByIdObj({
            $type$: 'OneTest$Email',
            messageID: 'dummy-123.123@dummy.com'
        });
        expect({
            ...email.obj,
            attachment: email.obj.attachment
                ? [...email.obj.attachment.sort()]
                : email.obj.attachment
        }).to.deep.equal({
            ...emailCreationResult.obj,
            attachment: emailCreationResult.obj.attachment
                ? [...emailCreationResult.obj.attachment.sort()]
                : emailCreationResult.obj.attachment
        });
    });

    it('should load versioned object by ID hash', async () => {
        const [, emailCreationResult] = await createTestObjects();
        const email = await getObjectByIdHash(emailCreationResult.idHash);
        expect({
            ...email.obj,
            attachment: email.obj.attachment
                ? [...email.obj.attachment.sort()]
                : email.obj.attachment
        }).to.deep.equal({
            ...emailCreationResult.obj,
            attachment: emailCreationResult.obj.attachment
                ? [...emailCreationResult.obj.attachment.sort()]
                : emailCreationResult.obj.attachment
        });
    });

    it('should FAIL to load non-existing versioned object', async () => {
        try {
            await getObjectByIdObj({
                $type$: 'OneTest$Email',
                messageID: 'THIS OBJECT DOES NOT EXIST IN STORAGE'
            });
        } catch (err) {
            expect(err.name, err.stack).to.equal('FileNotFoundError');
        }
    });

    it('should create 5 versions of a Person object and get objects by ID-object', async () => {
        const testObj: OneTest$Email = {
            $type$: 'OneTest$Email',
            messageID: 'randomMsgId@email',
            date: 1573296835671,
            subject: 'Subject line'
        };

        const testObjects = [
            Object.assign({}, testObj),
            Object.assign({}, testObj),
            Object.assign({}, testObj),
            Object.assign({}, testObj),
            Object.assign({}, testObj)
        ];

        testObjects[1].date = 1573296835682;
        testObjects[1].subject = 'Subject line 2';
        testObjects[2].date = 1573296835711;
        testObjects[2].subject = 'Subject line 3';
        testObjects[3].date = 1573296835852;
        testObjects[3].subject = 'Subject line 4';
        testObjects[4].date = 1573296835983;
        testObjects[4].subject = 'Subject line 5';

        for (const obj of testObjects) {
            await storeVersionedObject(obj);
        }

        // const versions = await listVersionsByIdObj(testObjects[0]);
        // expect(versions.length).to.equal(5);
        //
        // const get1stObject = await getObjectByIdObj(testObjects[0], 0);
        // expect(get1stObject.obj).to.deep.equal(testObjects[0]);
        //
        // const get2ndObject = await getObjectByIdObj(testObjects[0], 1);
        // expect(get2ndObject.obj).to.deep.equal(testObjects[1]);
        //
        // const get3rdObject = await getObjectByIdObj(testObjects[0], 2);
        // expect(get3rdObject.obj).to.deep.equal(testObjects[2]);
        //
        // const get4thObject = await getObjectByIdObj(testObjects[0], 3);
        // expect(get4thObject.obj).to.deep.equal(testObjects[3]);
        //
        // const get5thObject = await getObjectByIdObj(testObjects[0], 4);
        // expect(get5thObject.obj).to.deep.equal(testObjects[4]);
        //
        // const getLastObject = await getObjectByIdObj(testObjects[0]);
        // expect(getLastObject.obj).to.deep.equal(testObjects[4]);
    });

    it('should always create version map entry for new objects even if policy="NONE"', async () => {
        // TEST 1: a completely new object (ID object is new)
        const obj1: OneTest$Email = {
            $type$: 'OneTest$Email',
            messageID: 'randomMsgId-3@email',
            date: 1573296838682,
            subject: 'Subject line for test'
        };

        const obj1Result = await storeVersionedObject(obj1);

        // TEST 2: a new object for an existing ID object
        const obj2: OneTest$Email = {
            $type$: 'OneTest$Email',
            messageID: 'randomMsgId-3@email',
            date: 1573296838891,
            subject: 'Subject line for the test'
        };

        const obj2Result = await storeVersionedObject(obj2);
        const currentNode = await getCurrentVersionNode(obj1Result.idHash);
        expect(currentNode.obj.$type$).to.equal('VersionNodeChange');

        const currentNodeChange = currentNode.obj as VersionNodeChange;

        const prevNode = await getObject(currentNodeChange.prev);
        const prevObj = await getObject(prevNode.data);

        const prevNodeObjMicrodata = convertObjToMicrodata(prevObj);
        expect(await createCryptoHash(prevNodeObjMicrodata)).to.equal(obj1Result.hash);

        const currentObj = await getObject(currentNodeChange.data);
        const currentObjMicrodata = convertObjToMicrodata(currentObj);
        const objHash = await createCryptoHash(currentObjMicrodata);
        expect(objHash).to.equal(obj2Result.hash);
    });

    it('should create an Email object', async () => {
        const planResult = await storeVersionedObject({
            $type$: 'OneTest$Email',
            messageID: (await createRandomString(15)) + '@' + (await createRandomString(15)),
            date: 1573296835671,
            subject: 'Guy'
        });

        expect(planResult.obj.$type$).to.equal('OneTest$Email');
        expect(typeof planResult.obj.messageID).to.equal('string');
        expect(planResult.obj.messageID.length).to.equal(31);
        expect(planResult.obj.subject).to.equal('Guy');
        expect(isHash(planResult.hash)).to.be.true;
        expect(isHash(planResult.idHash)).to.be.true;
        expect(planResult.status).to.equal('new');
        expect(typeof planResult.timestamp).to.equal('number');
    });

    it('should refuse to start instance if "secret" is wrong', async () => {
        closeInstance();

        const instanceObjInitial = await StorageTestInit.init({
            email: 'test@test.com',
            secret: 'ONE KEY',
            name: 'test',
            addTypes: false,
            deleteDb: true
        });

        const instanceObj1 = await getObjectByIdObj(instanceObjInitial);
        expect(instanceObj1.obj.recipe.size).to.equal(0);

        closeInstance();

        async function fn(): Promise<void> {
            await StorageTestInit.init({
                email: 'test@test.com',
                secret: 'OTHER KEY',
                name: 'test',
                addTypes: false,
                deleteDb: false
            });
        }

        const result = await fn().catch(err => err);

        expect(result).to.be.instanceof(Error);
        // Browser uses storage-crypto and fails in storage-crypto fn "loadEncrypted"
        // Without storage-encryption failure is in instance-crypto "authenticateOwner"
        // Storage encryption comes before instance init because without initialized storage crypto
        // no Instance or owner (Person) objects can be touched.
        expect(result.message).to.contain(isNode ? 'CYENC-SYMDEC' : 'SC-LDENC');

        try {
            await closeAndDeleteCurrentInstance();
            expect(false).to.be.true;
        } catch (err) {
            expect(err.code).to.equal('IN-CADCI1');
        }
    });

    it('should start instance if "secret" is correct', async () => {
        closeInstance();

        const instanceObjInitial = await StorageTestInit.init({
            email: 'test@test.com',
            secret: 'ONE KEY',
            name: 'test',
            addTypes: false,
            deleteDb: true
        });

        const instanceObj1 = await getObjectByIdObj(instanceObjInitial);
        expect(instanceObj1.obj.recipe.size).to.equal(0);

        closeInstance();

        async function fn(): Promise<void> {
            await StorageTestInit.init({
                email: 'test@test.com',
                secret: 'ONE KEY',
                name: 'test',
                addTypes: false,
                deleteDb: false
            });
        }

        const result = await fn().catch(err => err);

        expect(result).to.be.undefined;

        await closeAndDeleteCurrentInstance();
    });

    it('should start the instance if key pairs are provided', async () => {
        closeInstance();

        const instanceKeyOptions: StorageHelpersInitOpts = {
            email: 'aqOshJ8q',
            personEncryptionKeyPair: {
                publicKey: ensurePublicKey(
                    hexToUint8ArrayWithCheck(
                        '9ffd9b93995867f8891452e1a39207be36433fcba9748ae1514d59decd1e2418'
                    )
                ),
                secretKey: ensureSecretKey(
                    hexToUint8ArrayWithCheck(
                        'e51e34fbccd5d81071f679a01f3f74392dcfa4f8bc30668adc52a5b6ef6f8d9d'
                    )
                )
            },
            personSignKeyPair: {
                publicKey: ensurePublicSignKey(
                    hexToUint8ArrayWithCheck(
                        'e14bdcc7efbc41d6afc136fc8397319577288636209ae0657367267ab00e2ebc'
                    )
                ),
                secretKey: ensureSecretSignKey(
                    hexToUint8ArrayWithCheck(
                        'e7a860913d7558cbe2c04d3df9fe524ed1cd7cd4d086c4344a67f01df6b2062de14bdcc7efbc41d6afc136fc8397319577288636209ae0657367267ab00e2ebc'
                    )
                )
            }
        };

        const instanceObjInitial = await StorageTestInit.init(instanceKeyOptions);

        const instanceObj1 = await getObjectByIdObj(instanceObjInitial);
        expect(instanceObj1.obj.recipe.size).to.equal(0);

        closeInstance();

        async function fn(): Promise<void> {
            await StorageTestInit.init(instanceKeyOptions);
        }

        const result = await fn().catch(err => err);

        expect(result).to.be.undefined;

        await closeAndDeleteCurrentInstance();
    });

    it('(node.js) should start the instance if no secret is provided but key pairs are provided', async () => {
        if (!isNode) {
            return;
        }

        closeInstance();

        const instanceKeyOptions: StorageHelpersInitOpts = {
            email: 'aqOshJ8q',
            personEncryptionKeyPair: {
                publicKey: ensurePublicKey(
                    hexToUint8ArrayWithCheck(
                        '9ffd9b93995867f8891452e1a39207be36433fcba9748ae1514d59decd1e2418'
                    )
                ),
                secretKey: ensureSecretKey(
                    hexToUint8ArrayWithCheck(
                        'e51e34fbccd5d81071f679a01f3f74392dcfa4f8bc30668adc52a5b6ef6f8d9d'
                    )
                )
            },
            personSignKeyPair: {
                publicKey: ensurePublicSignKey(
                    hexToUint8ArrayWithCheck(
                        'e14bdcc7efbc41d6afc136fc8397319577288636209ae0657367267ab00e2ebc'
                    )
                ),
                secretKey: ensureSecretSignKey(
                    hexToUint8ArrayWithCheck(
                        'e7a860913d7558cbe2c04d3df9fe524ed1cd7cd4d086c4344a67f01df6b2062de14bdcc7efbc41d6afc136fc8397319577288636209ae0657367267ab00e2ebc'
                    )
                )
            },
            secret: 'dummy'
        };

        const instanceObjInitial = await StorageTestInit.init(instanceKeyOptions);

        const instanceObj1 = await getObjectByIdObj(instanceObjInitial);
        expect(instanceObj1.obj.recipe.size).to.equal(0);

        closeInstance();

        async function fn(): Promise<void> {
            await StorageTestInit.init(instanceKeyOptions);
        }

        const result = await fn().catch(err => err);

        expect(result).to.be.undefined;

        await closeAndDeleteCurrentInstance();
    });

    it('(node.js) should be able to encrypt/decrypt message with supplied person encryption key', async () => {
        if (!isNode) {
            return;
        }

        closeInstance();

        const instanceKeyOptions: StorageHelpersInitOpts = {
            email: 'aqOshJ8q',
            personEncryptionKeyPair: {
                publicKey: ensurePublicKey(
                    hexToUint8ArrayWithCheck(
                        '9ffd9b93995867f8891452e1a39207be36433fcba9748ae1514d59decd1e2418'
                    )
                ),
                secretKey: ensureSecretKey(
                    hexToUint8ArrayWithCheck(
                        'e51e34fbccd5d81071f679a01f3f74392dcfa4f8bc30668adc52a5b6ef6f8d9d'
                    )
                )
            },
            personSignKeyPair: {
                publicKey: ensurePublicSignKey(
                    hexToUint8ArrayWithCheck(
                        'e14bdcc7efbc41d6afc136fc8397319577288636209ae0657367267ab00e2ebc'
                    )
                ),
                secretKey: ensureSecretSignKey(
                    hexToUint8ArrayWithCheck(
                        'e7a860913d7558cbe2c04d3df9fe524ed1cd7cd4d086c4344a67f01df6b2062de14bdcc7efbc41d6afc136fc8397319577288636209ae0657367267ab00e2ebc'
                    )
                )
            },
            secret: 'dummy'
        };

        await StorageTestInit.init(instanceKeyOptions);

        const ownerIdHash = getInstanceOwnerIdHash();

        if (ownerIdHash === undefined) {
            throw new Error('owner ID hash is undefined');
        }

        // test if the supplied encryption keys work for encryption and decryption

        const cryptoApi = await createCryptoApiFromDefaultKeys(ownerIdHash);

        expect(cryptoApi.publicEncryptionKey).to.deep.equal(
            instanceKeyOptions.personEncryptionKeyPair?.publicKey
        );

        const something = hexToUint8ArrayWithCheck('aabb01452cf78a');
        const encryptedSomething = cryptoApi.encryptAndEmbedNonce(
            something,
            cryptoApi.publicEncryptionKey
        );
        // decryptWithPersonPublicKey will use the supplied secretEncryptionKey
        const testSomething = cryptoApi.decryptWithEmbeddedNonce(
            encryptedSomething,
            cryptoApi.publicEncryptionKey
        );
        expect(something).to.deep.equal(testSomething);

        await closeAndDeleteCurrentInstance();
    });

    it('should load types stored with an instance', async () => {
        closeInstance();

        const instanceObjInitial = await StorageTestInit.init({
            email: 'test@test.com',
            name: 'test',
            addTypes: false,
            deleteDb: true
        });

        const instanceObj1 = await getObjectByIdObj(instanceObjInitial);
        expect(instanceObj1.obj.recipe.size).to.equal(0);

        const r1 = await updateInstance({recipes: TEST_RECIPES});
        expect(r1.obj.$type$).to.equal('Instance');
        expect(r1.obj.recipe.size).to.equal(TEST_RECIPES.length);

        const instanceObj2 = await getObjectByIdObj(instanceObjInitial);
        expect(instanceObj2.obj.recipe.size).to.equal(TEST_RECIPES.length);
        closeInstance();

        const instanceObjReloaded = await StorageTestInit.init({
            email: 'test@test.com',
            name: 'test',
            addTypes: false,
            deleteDb: false
        });

        expect(instanceObjReloaded.recipe.size).to.equal(TEST_RECIPES.length);

        for (const refObj of instanceObjReloaded.recipe) {
            const recipeObj: Recipe = await getObjectWithType(refObj, 'Recipe');
            expect(ObjectRecipes.hasRecipe(recipeObj.name), 'Type not installed: ' + recipeObj.name)
                .to.be.true;
        }

        await closeAndDeleteCurrentInstance();
    });

    it('should store versioned object with optionals', async () => {
        closeInstance();

        await StorageTestInit.init({
            email: 'test@test.com',
            name: 'test',
            addTypes: true,
            deleteDb: true
        });

        const result = await storeVersionedObject({
            $type$: 'OneTest$TestVersionedOptional',
            id2: 'dummy'
        });

        // This throws, but it shouldn't
        const idObj = await getIdObject(result.idHash);

        expect(idObj).to.deep.equal({
            $type$: 'OneTest$TestVersionedOptional',
            id2: 'dummy'
        });

        await closeAndDeleteCurrentInstance();
    });

    it('should get an ID hash from the hash of a stored object using getIdHash()', async () => {
        closeInstance();

        await StorageTestInit.init({
            email: 'test@test.com',
            name: 'test',
            addTypes: true,
            deleteDb: true
        });

        const result = await storeVersionedObject({
            $type$: 'OneTest$TestVersionedOptional',
            id2: 'dummy'
        });

        const idHash = await getIdHash(result.hash);
        expect(idHash).to.be.equal(result.idHash);

        await closeAndDeleteCurrentInstance();
    });

    const instanceOptions = {
        name: 'personA',
        email: 'personA',
        secret: 'personA'
    };

    // BROWSER ONLY
    // FOR THIS TEST both before() and after() need to be disabled. Make sure the DB is deleted
    // before this test is run.
    it.skip('should create an instance, close it and re-open it', async () => {
        if (!isBrowser) {
            return;
        }

        if (!PerformanceObserver.supportedEntryTypes.includes('navigation')) {
            throw new Error('Cannot determine navigation type (not a browser?)');
        }

        // Type cast to "any": The lib.dom for PerformanceEntry is wrong, for type
        // "navigation" there DOES exist the "type" property!
        // TS issue: https://github.com/microsoft/TypeScript/issues/58644
        function pageWasRealoaded(): boolean {
            return performance
                .getEntriesByType('navigation')
                .some(entry => (entry as any).type === 'reload');
        }

        if (!pageWasRealoaded()) {
            await initInstance({
                name: instanceOptions.name,
                email: instanceOptions.email,
                secret: instanceOptions.email,
                ownerName: instanceOptions.name,
                initialRecipes: [],
                encryptStorage: true
            });

            closeInstance();

            window.location.reload();
        }

        if (pageWasRealoaded()) {
            const instanceIdHash = await calculateIdHashOfObj({
                $type$: 'Instance',
                name: instanceOptions.name,
                owner: await calculateIdHashOfObj({$type$: 'Person', email: instanceOptions.email})
            });

            await initStorage({
                instanceIdHash,
                wipeStorage: false,
                encryptStorage: true,
                name: 'data',
                nHashCharsForSubDirs: 0,
                secretForStorageKey: instanceOptions.secret
            });

            const existingInstance = await getObjectByIdHash(instanceIdHash);

            expect(existingInstance.obj.$type$).to.equal('Instance');
        }
    });

    it.skip('should create objects 1-by-1 and measure the time it takes', async function test13() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(250000);

        const startTime = Date.now();
        console.log('Start one-by-one unversioned obj. creation... (this may take a while)');

        const objsPromises = new Array(1000);

        for (let i = 0; i < objsPromises.length; i++) {
            objsPromises[i] = storeUnversionedObject({
                $type$: 'OneTest$TestUnversioned',
                data: [
                    'Getting it to work with higher values\n' +
                        'Although most common Unicode values can be represented with one ' +
                        '16-bit number (as expected early on during JavaScript ' +
                        'standardization) and fromCharCode() can be used to return a single ' +
                        'character for the most common values (i.e., UCS-2 values which are ' +
                        'the subset of UTF-16 with the most common characters), in order ' +
                        'to deal with ALL legal Unicode values (up to 21 bits), ' +
                        'fromCharCode() alone is inadequate. Since the higher code point ' +
                        'characters use two (lower value) "surrogate" numbers to form a ' +
                        'single character, String.fromCodePoint() (part of the ES2015 ' +
                        'standard) can be used to return such a pair and thus adequately' +
                        ' represent these higher valued characters.'
                ]
            });
        }

        await Promise.all(objsPromises);

        console.log('Done, duration ' + String((Date.now() - startTime) / 1000) + 's');
    });
});
