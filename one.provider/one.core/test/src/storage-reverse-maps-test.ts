import {expect} from 'chai';

import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import {extractIdObject} from '../../lib/microdata-to-id-hash.js';
import {ensureValidTypeName} from '../../lib/object-recipes.js';
import type {BLOB, VersionNodeChange, VersionNodeEdge} from '../../lib/recipes.js';
import {
    getAllEntries,
    getAllIdObjectEntries,
    getOnlyLatestReferencingObjsHash
} from '../../lib/reverse-map-query.js';
import {STORAGE} from '../../lib/storage-base-common.js';
import {readBlobAsArrayBuffer, storeUTF8Clob} from '../../lib/storage-blob.js';
import type {UnversionedObjectResult} from '../../lib/storage-unversioned-objects.js';
import {getObject, storeUnversionedObject} from '../../lib/storage-unversioned-objects.js';
import type {VersionedObjectResult} from '../../lib/storage-versioned-objects.js';
import {
    getVersionNodeByNodeHash,
    storeIdObject,
    storeVersionedObject,
    getVersionsNodeHashes
} from '../../lib/storage-versioned-objects.js';
import {createCryptoHash} from '../../lib/system/crypto-helpers.js';
import {
    listAllIdHashes,
    listAllObjectHashes,
    listAllReverseMapNames,
    readUTF8TextFile
} from '../../lib/system/storage-base.js';
import {createFileWriteStream} from '../../lib/system/storage-streams.js';
import {isString} from '../../lib/util/type-checks-basic.js';
import type {SHA256Hash, SHA256IdHash} from '../../lib/util/type-checks.js';
import {ensureHash, isHash} from '../../lib/util/type-checks.js';
import {getCurrentVersionNode} from '../../lib/storage-versioned-objects.js';

import * as StorageTestInit from './_helpers.js';
import type {OneTest$Email, OneTest$KeyValueMap, OneTest$ReferenceTest, OneTest$VersionedReferenceTest} from './_register-types.js';

async function createTestObjects(): Promise<
    [
        UnversionedObjectResult<OneTest$KeyValueMap>,
        VersionedObjectResult<OneTest$Email>,
        UnversionedObjectResult<OneTest$ReferenceTest>
    ]
> {
    const kvMap = await storeUnversionedObject({
        $type$: 'OneTest$KeyValueMap',
        name: 'Demo Map',
        keyJsType: 'string',
        valueJsType: 'string',
        item: [
            {
                key: 'key 1',
                value: ['value 1']
            },
            {
                key: 'key 2',
                value: ['value 2']
            },
            {
                key: 'key 3',
                value: ['value 3']
            }
        ]
    });

    const versionedObj: OneTest$Email = {
        $type$: 'OneTest$Email',
        messageID: 'randomMsgId@email',
        date: 1573296835671,
        subject: 'Subject line'
    };

    const email = await storeVersionedObject(versionedObj);

    const clobResult = await storeUTF8Clob(
        `
<h2>5.3 Somatosensory Neurons have Receptive Fields</h2>h2>

<p>Each subcortical somatosensory neuron responds to modality-specific stimuli applied to a specific
region of the body or face.</p>

<p>For example, an axon in the medial lemniscus (i.e., the fiber tract) that responds to tactile
stimulation of the right index finger pad will not respond to tactile stimulation of any other
area in the hand, body or face. The stimulated area producing the response is called the neuron’s
receptive field (Figure 5.3). The neuron’s receptive field can also be defined anatomically as
that area of the sense organ (i.e., skin, muscles or joints) innervated directly or indirectly by
the neuron. Consequently, a somatosensory neuron can be described to channel information about
stimulus location - as well as stimulus modality. Furthermore, the size of a neuron’s receptive
field is related to the body area innervated/represented. The receptive fields of neurons
innervating/representing the finger pads, lips, and tongue are the smallest, whereas those of
neurons innervating/representing the shoulders, back and legs are the largest. For greater
accuracy in locating the point of stimulus contact or movement, smaller cutaneous receptive fields
are required. For fine motor control, as in playing the piano or speaking, small proprioceptive
receptive fields are required.</p>

`.repeat(4)
    );

    const blob1Stream = createFileWriteStream();
    blob1Stream.promise.catch(err => console.log(err));

    for (let i = 1; i < 2; i++) {
        const uint8Array = new Uint8Array(256);

        for (let j = 0; j < uint8Array.byteLength; j++) {
            uint8Array[j] = (i * j) % 255;
        }

        blob1Stream.write(uint8Array.buffer);
    }

    const blob1Result = await blob1Stream.end();

    const blob2Stream = createFileWriteStream();
    blob2Stream.promise.catch(err => console.log(err));

    const uint8Array = new Uint8Array(256);

    for (let j = 0; j < uint8Array.byteLength; j++) {
        uint8Array[j] = (j * j) % 255;
    }

    blob2Stream.write(uint8Array.buffer);

    const blob2Result = await blob2Stream.end();

    const refParent = await storeUnversionedObject({
        $type$: 'OneTest$ReferenceTest',
        versionedRef: [email.hash],
        unversionedRef: [kvMap.hash],
        idRef: [email.idHash],
        clob: [clobResult.hash],
        blob: [blob1Result.hash, blob2Result.hash]
    });

    return [kvMap, email, refParent];
}

describe('Storage reverse map test', () => {
    before(async () => {
        startLogger({types: ['error']});
        await StorageTestInit.init();
    });

    after(async () => {
        await closeAndDeleteCurrentInstance();
        stopLogger();
    });

    it('should create cross-referencing versioned and unversioned objects and reverse maps', async () => {
        const filesBefore = new Set(await listAllObjectHashes());
        const versionMapFilesBefore = new Set(await listAllIdHashes());
        const reverseMapFilesBefore = new Set(await listAllReverseMapNames());

        // - 1 unversioned OneTest$KeyValueMap
        // - 1 versioned OneTest$Email object
        // - 1 version mapOneTest$Email (OneTest$Email)
        // - 1 ID object (OneTest$Email)
        // - 1 unversioned OneTest$ReferenceTest
        // - 2 reverse maps OneTest$KeyValueMap => OneTest$ReferenceTest
        // - 1 reverse map OneTest$Email => OneTest$ReferenceTest
        // - 1 reverse map ID OneTest$Email => OneTest$ReferenceTest
        // - 2 reverse maps OneTest$KeyValueMap, OneTest$Email => OneTest$ReferenceTest
        // - 1 reverse map CLOB => OneTest$ReferenceTest
        // - 2 reverse maps BLOB => OneTest$ReferenceTest
        const [_kvMap, _email, refParent] = await createTestObjects();

        if (!Array.isArray(refParent.obj.blob) || !Array.isArray(refParent.obj.clob)) {
            throw new Error('Object creation must have failed');
        }

        // Find the difference
        const filesAfter = await (async () => {
            const s = new Set(await listAllObjectHashes());
            filesBefore.forEach(file => s.delete(file));
            return Array.from(s);
        })();

        const versionMapFilesAfter = await (async () => {
            const s = new Set(await listAllIdHashes());
            versionMapFilesBefore.forEach(file => s.delete(file));
            return Array.from(s);
        })();

        const reverseMapFilesAfter = await (async () => {
            const s = new Set(await listAllReverseMapNames());
            reverseMapFilesBefore.forEach(file => s.delete(file));
            return Array.from(s);
        })();

        const actualObjects = new Map(
            (
                await Promise.all(
                    filesAfter.map(async file => {
                        return (refParent.obj.blob || []).includes(file as any)
                            ? await readBlobAsArrayBuffer(file as SHA256Hash<BLOB>)
                            : await readUTF8TextFile(file);
                    })
                )
            ).map((obj, index) => [filesAfter[index], obj])
        );

        const actualVersionMaps = new Map(
            (
                await Promise.all(
                    versionMapFilesAfter.map(file => readUTF8TextFile(file, STORAGE.VHEADS))
                )
            ).map((obj, index) => [versionMapFilesAfter[index], obj])
        );

        const actualReverseMaps = new Map(
            (
                await Promise.all(
                    reverseMapFilesAfter.map(file => readUTF8TextFile(file, STORAGE.RMAPS))
                )
            ).map((obj, index) => [reverseMapFilesAfter[index], obj])
        );

        // The sequence of the two BLOB references in the ReferenceTest object depends on
        // their actual string values.
        const [_idx1, _idx2] = refParent.obj.blob[0] < refParent.obj.blob[1] ? [0, 1] : [1, 0];

        // =============================================================================
        // Checking the results
        // =============================================================================

        // console.log(actualObjects);
        // console.log(actualReverseMaps);

        // =============================================================================
        // 2 OneTest$KeyValueMap
        // =============================================================================

        const expectedKeyValueMapObj =
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$KeyValueMap">' +
                '<span itemprop="name">Demo Map</span>' +
                '<span itemprop="keyJsType">string</span>' +
                '<span itemprop="valueJsType">string</span>' +
                '<ol itemprop="item">' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="key">key 1</span>' +
                            '<ol itemprop="value">' +
                                '<li>value 1</li>' +
                            '</ol>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="key">key 2</span>' +
                            '<ol itemprop="value">' +
                                '<li>value 2</li>' +
                            '</ol>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="key">key 3</span>' +
                            '<ol itemprop="value">' +
                                '<li>value 3</li>' +
                            '</ol>' +
                        '</div>' +
                    '</li>' +
                '</ol>' +
            '</div>';

        const expectedKeyValueMapObjHash = await createCryptoHash(expectedKeyValueMapObj);

        expect(actualObjects.get(expectedKeyValueMapObjHash)).to.equal(expectedKeyValueMapObj);

        actualObjects.delete(expectedKeyValueMapObjHash);

        // =============================================================================
        // 3 OneTest$Email
        // =============================================================================

        const expectedEmailObj =
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$Email">' +
                '<span itemprop="messageID">randomMsgId@email</span>' +
                '<span itemprop="date">1573296835671</span>' +
                '<span itemprop="subject">Subject line</span>' +
            '</div>';

        const expectedEmailIdObj = extractIdObject(expectedEmailObj);

        if (!isString(expectedEmailIdObj)) {
            throw new Error('Could not extract ID object from expectedEmailObj');
        }

        const expectedEmailObjHash = await createCryptoHash(expectedEmailObj);
        const expectedEmailIdObjHash = await createCryptoHash(expectedEmailIdObj);

        expect(actualObjects.get(expectedEmailObjHash)).to.equal(expectedEmailObj);
        expect(actualObjects.get(expectedEmailIdObjHash)).to.equal(expectedEmailIdObj);

        actualObjects.delete(expectedEmailObjHash);
        actualObjects.delete(expectedEmailIdObjHash);

        // =============================================================================
        // 4 VersionMap (OneTest$Email)
        // =============================================================================

        const expectedEmailIdHash = (await createCryptoHash(
            // prettier-ignore
            '<div data-id-object="true" itemscope itemtype="//refin.io/OneTest$Email">' +
                '<span itemprop="messageID">randomMsgId@email</span>' +
            '</div>'
        )) as unknown as SHA256IdHash;

        // stored under expectedOneTest$Email IdHash
        const expectedEmailVersionMapObj = expectedEmailObjHash + '\n';
        const versionNode = await getObject(
            actualVersionMaps.get(expectedEmailIdHash) as SHA256Hash
        );

        expect(versionNode.$type$).to.equal('VersionNodeEdge');
        expect((versionNode as VersionNodeEdge).data + '\n').to.equal(expectedEmailVersionMapObj);

        actualObjects.delete(actualVersionMaps.get(expectedEmailIdHash) as SHA256Hash);
        actualVersionMaps.delete(expectedEmailIdHash);

        // =============================================================================
        // 5 OneTest$ReferenceTest
        // =============================================================================

        const expectedReferenceTestObj =
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$ReferenceTest">' +
                '<ul itemprop="versionedRef">' +
                    '<li>' +
                        '<a data-type="obj">4277e590c4012f7f7193f14bfd9787464b50e0ead149624ecaec52584323e214</a>' +
                    '</li>' +
                '</ul>' +
                '<ul itemprop="unversionedRef">' +
                    '<li>' +
                        '<a data-type="obj">f50fd0147a9a76e7268fbcc8048ea053303f1ea1d4106a9c70d334d0fd9fc0da</a>' +
                    '</li>' +
                '</ul>' +
                '<ul itemprop="idRef">' +
                    '<li>' +
                        '<a data-type="id">54ee7dddd7144bed9316805b520208cf1eec8802beef6a1686631d3e45dd3f44</a>' +
                    '</li>' +
                '</ul>' +
                '<ul itemprop="clob">' +
                    '<li>' +
                        '<a data-type="clob">2912d75df5a21365ff6af395308f8f7fc978cd4ba68a8847d0fa85cc00317b6c</a>' +
                    '</li>' +
                '</ul>' +
                '<ul itemprop="blob">' +
                    '<li>' +
                        '<a data-type="blob">4f374557bf44bb12ba2663f8a84e9515165a2332c1f3059d6d81dfe1379eb77b</a>' +
                    '</li>' +
                    '<li>' +
                        '<a data-type="blob">86e2bb19662953a95cbb658bef0c8e16edb608ca7dbb960bf272537ad19e9a7c</a>' +
                    '</li>' +
                '</ul>' +
            '</div>';

        const expectedReferenceTestObjHash = await createCryptoHash(expectedReferenceTestObj);

        expect(actualObjects.get(expectedReferenceTestObjHash)).to.equal(expectedReferenceTestObj);

        if (!actualObjects.delete(expectedReferenceTestObjHash)) {
            console.log('Could not delete expectedReferenceTestObjHash');
        }

        // =============================================================================
        // 5.1. OneTest$ReferenceTest: 1 CLOB and 2 BLOB files
        // =============================================================================

        expect(actualObjects.get(refParent.obj.clob[0])).to.equal(
            await readUTF8TextFile(refParent.obj.clob[0])
        );

        if (!actualObjects.delete(refParent.obj.clob[0])) {
            console.log('Could not delete CLOB');
        }

        // Don't check the BLOB files. For one, they were read into actualObjects as text, but
        // they are not important either, because this test is about the reverse maps not
        // the files.
        if (!actualObjects.delete(refParent.obj.blob[0])) {
            console.log('Could not delete BLOB0');
        }

        if (!actualObjects.delete(refParent.obj.blob[1])) {
            console.log('Could not delete BLOB1');
        }

        // =============================================================================
        // 6 Reverse map (Email (ID) => OneTest$ReferenceTest) TWO ENTRIES
        // =============================================================================

        const expectedReverseMap1Obj = expectedReferenceTestObjHash + '\n';
        const expectedReverseMap1ObjHash = expectedEmailIdObjHash + '.Object.OneTest$ReferenceTest';

        expect(actualReverseMaps.get(expectedReverseMap1ObjHash)).to.equal(expectedReverseMap1Obj);

        actualReverseMaps.delete(expectedReverseMap1ObjHash);

        // =============================================================================
        // 7 Reverse map (OneTest$KeyValueMap => OneTest$ReferenceTest)
        // =============================================================================

        const expectedReverseMap2Obj = expectedReferenceTestObjHash + '\n';
        const expectedReverseMap2ObjHash =
            expectedKeyValueMapObjHash + '.Object.OneTest$ReferenceTest';

        expect(actualReverseMaps.get(expectedReverseMap2ObjHash)).to.equal(expectedReverseMap2Obj);

        actualReverseMaps.delete(expectedReverseMap2ObjHash);

        // =============================================================================
        // 12 Reverse map (OneTest$Email => OneTest$ReferenceTest)
        // =============================================================================

        const expectedReverseMap5aObj = expectedReferenceTestObjHash + '\n';
        const expectedReverseMap5aObjHash = expectedEmailObjHash + '.Object.OneTest$ReferenceTest';

        expect(actualReverseMaps.get(expectedReverseMap5aObjHash)).to.equal(
            expectedReverseMap5aObj
        );

        actualReverseMaps.delete(expectedReverseMap5aObjHash);

        // =============================================================================
        // 16 Reverse map (CLOB => OneTest$ReferenceTest)
        // =============================================================================

        const expectedReverseMap9Obj = expectedReferenceTestObjHash + '\n';
        const expectedReverseMap9ObjHash = refParent.obj.clob[0] + '.Object.OneTest$ReferenceTest';

        expect(actualReverseMaps.get(expectedReverseMap9ObjHash)).to.equal(expectedReverseMap9Obj);

        actualReverseMaps.delete(expectedReverseMap9ObjHash);

        // =============================================================================
        // 17 Reverse map (BLOB-0 => OneTest$ReferenceTest)
        // =============================================================================

        const expectedReverseMap10Obj = expectedReferenceTestObjHash + '\n';
        const expectedReverseMap10ObjHash = refParent.obj.blob[0] + '.Object.OneTest$ReferenceTest';

        expect(actualReverseMaps.get(expectedReverseMap10ObjHash)).to.equal(
            expectedReverseMap10Obj
        );

        actualReverseMaps.delete(expectedReverseMap10ObjHash);

        // =============================================================================
        // 18 Reverse map (BLOB-1 => OneTest$ReferenceTest)
        // =============================================================================

        const expectedReverseMap11Obj = expectedReferenceTestObjHash + '\n';
        const expectedReverseMap11ObjHash = refParent.obj.blob[1] + '.Object.OneTest$ReferenceTest';

        expect(actualReverseMaps.get(expectedReverseMap11ObjHash)).to.equal(
            expectedReverseMap11Obj
        );

        actualReverseMaps.delete(expectedReverseMap11ObjHash);

        // =============================================================================
        // FINAL TALLY
        // =============================================================================

        expect(
            actualObjects.size,
            'Unexplained actualObjects entries left:\n' +
                Array.from(actualObjects.entries()).map(
                    ([k, v]) => `${k} => ${isString(v) ? v : 'ArrayBuffer'}`
                )
        ).to.equal(0);
        expect(
            actualVersionMaps.size,
            'Unexplained actualVersionMaps entries left:\n' +
                Array.from(actualVersionMaps.entries()).map(([k, v]) => `${k} => ${v}`)
        ).to.equal(0);
        expect(
            actualReverseMaps.size,
            'Unexplained actualReverseMaps entries left:\n' +
                Array.from(actualReverseMaps.entries()).map(([k, v]) => `${k} => ${v}`)
        ).to.equal(0);
    });

    it('should read all entries of reverse maps"', async () => {
        const reverseMapFiles = new Set(await listAllReverseMapNames());

        for (const name of reverseMapFiles.keys()) {
            const [targetHash, mapType, typeOfReferencingObj] = name.split('.');

            if (mapType === 'IdObject') {
                continue;
            }

            expect(mapType).to.be.equal('Object');

            const allEntries = await getAllEntries(
                ensureHash(targetHash),
                ensureValidTypeName(typeOfReferencingObj)
            );

            // TODO well, no error is a good start
            // console.log('allEntries', allEntries);

            expect(allEntries instanceof Array).to.be.true;
            expect(allEntries.every(entry => isHash(entry))).to.be.true;
        }
    });

    it('should read entries of reverse maps reverse-linking most current version', async () => {
        // First create the TARGETS of the links
        const [email1, email2] = await Promise.all([
            storeVersionedObject({
                $type$: 'OneTest$Email',
                messageID: '1-randomMsgId@email',
                date: Date.now(),
                subject: 'Subject line 1'
            }),
            storeVersionedObject({
                $type$: 'OneTest$Email',
                messageID: '2-randomMsgId@email',
                date: Date.now(),
                subject: 'Subject line 2'
            })
        ]);

        async function dumpVersions(idHash: SHA256IdHash): Promise<void> {
            const versions = await getVersionsNodeHashes(idHash);

            if (versions === undefined) {
                console.log('versions undefined', idHash);
                return;
            }

            for (const version of versions) {
                const versionNode = await getVersionNodeByNodeHash(version);
                console.log(
                    'version',
                    {...versionNode, data: await getObject(versionNode.obj.data)},
                    version
                );
            }
        }

        // Then create several versions of the same object linking the targets

        // FIRST VERSIONS - those will be superseded by later versions and should be filtered
        // out from the reverse map query result
        const v1 = await storeVersionedObject({
            $type$: 'OneTest$VersionedReferenceTest',
            name: 'Test', // ID property
            versionedRef: [email1.hash, email2.hash]
        });

        // SECOND VERSIONS - those too will be superseded
        const v2 = await storeVersionedObject({
            $type$: 'OneTest$VersionedReferenceTest',
            name: 'Test', // ID property
            versionedRef: [email2.hash]
        });

        // LATEST VERSION
        const v3 = await storeVersionedObject({
            $type$: 'OneTest$VersionedReferenceTest',
            name: 'Test',
            versionedRef: [email1.hash],
        });

        const preSaveResult3Node = await getCurrentVersionNode(v3.idHash);
        expect(preSaveResult3Node.obj.$type$).to.equal('VersionNodeChange');

        const preSaveResult3NodeChange = preSaveResult3Node.obj as VersionNodeChange;
        expect(preSaveResult3NodeChange.prev).not.undefined;

        const preSaveResult2Node = await getObject(preSaveResult3NodeChange.prev);
        expect(preSaveResult2Node.$type$).to.equal('VersionNodeChange');

        const preSaveResult2NodeChange = preSaveResult2Node as VersionNodeChange;
        expect(preSaveResult2NodeChange.prev).not.undefined;

        const preSaveResult1Node = await getObject(preSaveResult2NodeChange.prev);
        expect(preSaveResult1Node.$type$).to.equal('VersionNodeEdge');

        for (const [hash, type, expected] of [
            [email1.hash, 'OneTest$VersionedReferenceTest', [v3.hash]],
            [email2.hash, 'OneTest$VersionedReferenceTest', []]
        ] as const) {
            const onlyToLatest = await getOnlyLatestReferencingObjsHash(hash, type);
            expect(onlyToLatest, `Error with reverse map ${hash}.${type}`).to.deep.equal(expected);
        }

        // UPDATED LATEST VERSIONS #2
        await storeVersionedObject({
            $type$: 'OneTest$VersionedReferenceTest',
            name: 'Test',
            versionedRef: [email1.hash, email2.hash]
        });

        const result4Node = await getCurrentVersionNode(v1.idHash);
        expect(result4Node.obj.$type$).to.equal('VersionNodeChange');

        const v4Node = result4Node.obj as VersionNodeChange;
        expect(v4Node.prev).not.undefined;

        const result3Node = await getObject(v4Node.prev);
        expect(result3Node.$type$).to.equal('VersionNodeChange');

        const v3Node = result3Node as VersionNodeChange;
        expect(v3Node.prev).not.undefined;

        const result2Node = await getObject(v3Node.prev);
        expect(result2Node.$type$).to.equal('VersionNodeChange');

        const v2Node = result2Node as VersionNodeChange;
        expect(v2Node.prev).not.undefined;

        const result1Node = await getObject(v2Node.prev);
        expect(result1Node.$type$).to.equal('VersionNodeEdge');

        for (const [hash, type, expected] of [
            [email1.hash, 'OneTest$VersionedReferenceTest', [result4Node.obj.data]],
            [email2.hash, 'OneTest$VersionedReferenceTest', [result4Node.obj.data]]
        ] as const) {
            const onlyToLatest = await getOnlyLatestReferencingObjsHash(hash, type);
            expect(onlyToLatest, `Error with reverse map ${hash}.${type}`).to.deep.equal(expected);
        }
    });

    it('should create objects and test id reverse maps', async () => {
        const referencedObj = await storeVersionedObject({
            $type$: 'Person',
            email: 'abc'
        });

        const referencingObj = await storeVersionedObject({
            $type$: 'OneTest$VersionedReferenceTestAllId',
            name: 'abc',
            idRef: [referencedObj.idHash]
        });

        // We have one reference between id objects, so we expect here one entry
        const idEntries = await getAllIdObjectEntries(
            referencedObj.idHash,
            'OneTest$VersionedReferenceTestAllId'
        );
        expect(idEntries.length).to.be.equal(1);
        expect(idEntries[0]).to.be.equal(referencingObj.idHash);

        // This is expected to be 0, because we did not enable the reverse map for non id objects
        // If enabled this would be 1, because 1 version references the person object
        const entries = await getAllEntries(
            referencedObj.idHash,
            'OneTest$VersionedReferenceTestAllId'
        );
        expect(entries.length).to.be.equal(0);
    });

    it('should create id objects and test reverse maps', async () => {
        const referencedObj = await storeIdObject({
            $type$: 'Person',
            email: 'abc2'
        });

        const referencingObj = await storeIdObject({
            $type$: 'OneTest$VersionedReferenceTestAllId',
            name: 'abc',
            idRef: [referencedObj.idHash]
        });

        const entries = await getAllIdObjectEntries(
            referencedObj.idHash,
            'OneTest$VersionedReferenceTestAllId'
        );

        expect(entries.length).to.be.equal(1);
        expect(entries[0]).to.be.equal(referencingObj.idHash);
    });
});
