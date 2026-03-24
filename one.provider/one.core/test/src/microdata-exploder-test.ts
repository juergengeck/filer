/* eslint-disable no-console, arrow-parens, quotes */

import {expect} from 'chai';

import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import {explode} from '../../lib/microdata-exploder.js';
import {escapeForHtml} from '../../lib/object-to-microdata.js';
import type {BLOB, Person, Recipe} from '../../lib/recipes.js';
import {storeUTF8Clob} from '../../lib/storage-blob.js';
import type {UnversionedObjectResult} from '../../lib/storage-unversioned-objects.js';
import {storeUnversionedObject} from '../../lib/storage-unversioned-objects.js';
import type {VersionedObjectResult} from '../../lib/storage-versioned-objects.js';
import {storeVersionedObject} from '../../lib/storage-versioned-objects.js';
import {readUTF8TextFile} from '../../lib/system/storage-base.js';
import {createFileReadStream, createFileWriteStream} from '../../lib/system/storage-streams.js';
import type {SHA256Hash, SHA256IdHash} from '../../lib/util/type-checks.js';
import type {HexString} from '../../lib/util/arraybuffer-to-and-from-hex-string.js';

import * as StorageTestInit from './_helpers.js';
import type {OneTest$ChannelInfo, OneTest$Email, OneTest$Matryoschka} from './_register-types.js';

/**
 * Reads a binary file in its entirety and returns it as Base64 encoded string.
 * @private
 * @param {SHA256Hash} hash
 * @returns {Promise<string>}
 */
function readBlobAsBase64(hash: SHA256Hash<BLOB>): Promise<string> {
    return new Promise((resolve, reject) => {
        const stream = createFileReadStream(hash, 'base64');

        let data = '';

        stream.onData.addListener(chunk => {
            data += chunk;
        });

        stream.promise.then(() => resolve(data)).catch(err => reject(err));
    });
}

async function createTestObjects(): Promise<
    [
        VersionedObjectResult<Person>,
        VersionedObjectResult<Person>,
        VersionedObjectResult<Person>,
        VersionedObjectResult<OneTest$Email>,
        VersionedObjectResult<OneTest$ChannelInfo>
    ]
> {
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

`.repeat(5)
    );

    const blob1Stream = createFileWriteStream();
    blob1Stream.promise.catch(err => console.log(err));

    for (let i = 0; i < 10; i++) {
        const uint8Array = new Uint8Array(64 * 1002);

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

    const person1 = await storeVersionedObject({$type$: 'Person', email: 'Asomeone@somewhere.org'});
    const person2 = await storeVersionedObject({
        $type$: 'Person',
        email: 'Bsomeother@someother.com'
    });
    const person3 = await storeVersionedObject({
        $type$: 'Person',
        email: 'Cyetanother@somewhereelse.com'
    });

    const [idx1, idx2] = blob1Result.hash < blob2Result.hash ? [0, 1] : [1, 0];

    const attachments = [blob1Result.hash, blob2Result.hash];

    const email = await storeVersionedObject({
        $type$: 'OneTest$Email',
        messageID: 'dummy-123.123@dummy.com',
        subject: 'UNIQUE SUBJECT MAKES THIS FILE UNIQUE 455a95dae395c5ac4350c587197774fa77046f',
        from: [person1.idHash],
        to: [person2.idHash, person3.idHash],
        date: 1438418318011,
        html: clobResult.hash,
        attachment: [attachments[idx1], attachments[idx2]]
    });

    const wbcObservation = await storeUnversionedObject({
        $type$: 'OneTest$WbcObservation',
        acquisitionTime: '2020-09-04T12:10:01+01:00',
        Leukocytes: {
            value: '1',
            unit: ''
        }
    });

    const wbcObservationCreationTime = await storeUnversionedObject({
        $type$: 'OneTest$CreationTime',
        timestamp: 1,
        data: wbcObservation.hash
    });

    const wbcObservationLicense = await storeUnversionedObject({
        $type$: 'OneTest$License',
        description: '[signature.issuer] affirms that content of [data] is correct.',
        name: 'Affirmation'
    });

    const wbcObservationAffirmationCertificate = await storeUnversionedObject({
        $type$: 'OneTest$AffirmationCertificate',
        data: wbcObservationCreationTime.hash,
        license: wbcObservationLicense.hash
    });

    const wbcObservationSignature = await storeUnversionedObject({
        $type$: 'OneTest$Signature',
        data: wbcObservationAffirmationCertificate.hash,
        issuer: person1.idHash,
        signature:
            '011441140bd296f5bf8213252cfc6f027e76dc84bd14fc7bff691ece359bd5f908cb472bae7fb050fb38d1eb66beb1ae63d3f25f26114e554fb646eba732af0a' as HexString
    });

    const wbcObservationChannelEntry = await storeUnversionedObject({
        $type$: 'OneTest$ChannelEntry',
        data: wbcObservationCreationTime.hash,
        metadata: [wbcObservationSignature.hash]
    });

    const wbcObservationChannelInfo = await storeVersionedObject({
        $type$: 'OneTest$ChannelInfo',
        id: 'wbc',
        owner: person1.idHash,
        head: wbcObservationChannelEntry.hash
    });

    return [person1, person2, person3, email, wbcObservationChannelInfo];
}

function createNaschaImploded(
    tascha: UnversionedObjectResult<OneTest$Matryoschka>,
    sascha: UnversionedObjectResult<OneTest$Matryoschka>,
    wascha: UnversionedObjectResult<OneTest$Matryoschka>,
    mascha: UnversionedObjectResult<OneTest$Matryoschka>
): string {
    return (
        // prettier-ignore
        '<div itemscope itemtype="//refin.io/OneTest$Matryoschka">' +
            '<span itemprop="name">Nascha</span>' +
            '<ul itemprop="child">' +
                '<li>' +
                    `<span itemprop="child" data-hash="${tascha.hash}">` +
                        '<div itemscope itemtype="//refin.io/OneTest$Matryoschka">' +
                            '<span itemprop="name">Tascha</span>' +
                            '<ul itemprop="child">' +
                                '<li>' +
                                    `<span itemprop="child" data-hash="${sascha.hash}">` +
                                        '<div itemscope itemtype="//refin.io/OneTest$Matryoschka">' +
                                            '<span itemprop="name">Sascha</span>' +
                                            '<ul itemprop="child">' +
                                                '<li>' +
                                                    `<span itemprop="child" data-hash="${wascha.hash}">` +
                                                        '<div itemscope itemtype="//refin.io/OneTest$Matryoschka">' +
                                                            '<span itemprop="name">Wascha</span>' +
                                                            '<ul itemprop="child"></ul>' +
                                                        '</div>' +
                                                    '</span>' +
                                                '</li>' +
                                                '<li>' +
                                                    `<span itemprop="child" data-hash="${mascha.hash}">` +
                                                        '<div itemscope itemtype="//refin.io/OneTest$Matryoschka">' +
                                                            '<span itemprop="name">Mascha</span>' +
                                                            '<ul itemprop="child"></ul>' +
                                                        '</div>' +
                                                    '</span>' +
                                                '</li>' +
                                            '</ul>' +
                                        '</div>' +
                                    '</span>' +
                                '</li>' +
                            '</ul>' +
                        '</div>' +
                    '</span>' +
                '</li>' +
            '</ul>' +
        '</div>'
    );
}

declare module '@OneObjectInterfaces' {
    export interface OneIdObjectInterfaces {
        MiniProfile: Pick<MiniProfile, '$type$' | 'owner'>;
    }

    export interface OneVersionedObjectInterfaces {
        MiniProfile: MiniProfile;
    }
}

export interface MiniProfile {
    $type$: 'MiniProfile';
    owner: SHA256IdHash<Person>;
}

const MiniProfileRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'MiniProfile',
    rule: [
        {
            itemprop: 'owner',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])},
            isId: true
        }
    ]
};

const wbcObservationChannelInfoImploded =
    // prettier-ignore
    '<div itemscope itemtype="//refin.io/OneTest$ChannelInfo">' +
        '<span itemprop="id">wbc</span>' +
        '<span itemprop="owner" data-hash="450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6" data-id-hash="d8f2defb84c5ed89463e9679e2a2bb6f1d28e946a6a92f9a9ea288ce7b22e00c">' +
            '<div itemscope itemtype="//refin.io/Person">' +
                '<span itemprop="email">Asomeone@somewhere.org</span>' +
            '</div>' +
        '</span>' +
        '<span itemprop="head" data-hash="48465fa87fb79d35052f9f5660e0cb6b231111e167abd326f51c298efb570172">' +
            '<div itemscope itemtype="//refin.io/OneTest$ChannelEntry">' +
                '<span itemprop="data" data-hash="af91a38e78d7bffdc1f44e75cd95c406b44a983d26fec1b96f99d95da33b96be">' +
                    '<div itemscope itemtype="//refin.io/OneTest$CreationTime">' +
                        '<span itemprop="timestamp">1</span>' +
                        '<span itemprop="data" data-hash="15edde9d0975bd4d7ad8f451ddcbed16932ce90522e26a2259d1103504d2aee7">' +
                            '<div itemscope itemtype="//refin.io/OneTest$WbcObservation">' +
                                '<span itemprop="acquisitionTime">2020-09-04T12:10:01+01:00</span>' +
                                '<div itemprop="Leukocytes">' +
                                    '<span itemprop="value">1</span>' +
                                    '<span itemprop="unit"></span>' +
                                '</div>' +
                            '</div>' +
                        '</span>' +
                    '</div>' +
                '</span>' +
                '<ul itemprop="metadata">' +
                    '<li>' +
                        '<span itemprop="metadata" data-hash="a4bf8b66c274718192452ad34ec037b9d9b05de6a53c3e29aca46e2d1acd8e3f">' +
                            '<div itemscope itemtype="//refin.io/OneTest$Signature">' +
                                '<span itemprop="issuer" data-hash="450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6" data-id-hash="d8f2defb84c5ed89463e9679e2a2bb6f1d28e946a6a92f9a9ea288ce7b22e00c">' +
                                    '<div itemscope itemtype="//refin.io/Person">' +
                                        '<span itemprop="email">Asomeone@somewhere.org</span>' +
                                    '</div>' +
                                '</span>' +
                                '<span itemprop="data" data-hash="4a611538a994156f18deb8df52b45211d78a994159970ebdaf137cbd44913b57">' +
                                    '<div itemscope itemtype="//refin.io/OneTest$AffirmationCertificate">' +
                                        '<span itemprop="data" data-hash="af91a38e78d7bffdc1f44e75cd95c406b44a983d26fec1b96f99d95da33b96be">' +
                                            '<div itemscope itemtype="//refin.io/OneTest$CreationTime">' +
                                                '<span itemprop="timestamp">1</span>' +
                                                '<span itemprop="data" data-hash="15edde9d0975bd4d7ad8f451ddcbed16932ce90522e26a2259d1103504d2aee7">' +
                                                    '<div itemscope itemtype="//refin.io/OneTest$WbcObservation">' +
                                                        '<span itemprop="acquisitionTime">2020-09-04T12:10:01+01:00</span>' +
                                                        '<div itemprop="Leukocytes">' +
                                                            '<span itemprop="value">1</span>' +
                                                            '<span itemprop="unit"></span>' +
                                                        '</div>' +
                                                    '</div>' +
                                                '</span>' +
                                            '</div>' +
                                        '</span>' +
                                        '<span itemprop="license" data-hash="719665b14d53d1732dc45351d505d7e94d49dddb9aeb87954a68ce076f3fd4bb">' +
                                            '<div itemscope itemtype="//refin.io/OneTest$License">' +
                                                '<span itemprop="name">Affirmation</span>' +
                                                '<span itemprop="description">[signature.issuer] affirms that content of [data] is correct.</span>' +
                                            '</div>' +
                                        '</span>' +
                                    '</div>' +
                                '</span>' +
                                '<span itemprop="signature">' +
                                    '011441140bd296f5bf8213252cfc6f027e76dc84bd14fc7bff691ece359bd5f908cb472bae7fb050fb38d1eb66beb1ae63d3f25f26114e554fb646eba732af0a' +
                                '</span>' +
                            '</div>' +
                        '</span>' +
                    '</li>' +
                '</ul>' +
            '</div>' +
        '</span>' +
    '</div>';

describe('Microdata Exploder tests', () => {
    let _person1,
        _person2,
        _person3,
        email: VersionedObjectResult<OneTest$Email>,
        emailImploded: string,
        wbcObservationChannelInfo: VersionedObjectResult<OneTest$ChannelInfo>,
        nascha: UnversionedObjectResult<OneTest$Matryoschka>,
        mascha: UnversionedObjectResult<OneTest$Matryoschka>,
        wascha: UnversionedObjectResult<OneTest$Matryoschka>,
        sascha: UnversionedObjectResult<OneTest$Matryoschka>,
        tascha: UnversionedObjectResult<OneTest$Matryoschka>;

    // For this test replace these storage functions so that we don't actually go
    // to storage. Replace the replacement with the original in after().
    // eslint-disable-next-line no-console
    before(async () => {
        startLogger({includeInstanceName: true, types: ['error']});

        await StorageTestInit.init({initialRecipes: [MiniProfileRecipe]});

        [_person1, _person2, _person3, email, wbcObservationChannelInfo] =
            await createTestObjects();

        if (email.obj.attachment === undefined) {
            throw new Error('no attachment');
        }

        if (email.obj.html === undefined) {
            throw new Error('no html');
        }

        const [idx1, idx2] = email.obj.attachment[0] < email.obj.attachment[1] ? [0, 1] : [1, 0];

        emailImploded =
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$Email">' +
                '<span itemprop="messageID">dummy-123.123@dummy.com</span>' +
                '<ul itemprop="from">' +
                    '<li>' +
                        '<span itemprop="from" data-hash="450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6" data-id-hash="d8f2defb84c5ed89463e9679e2a2bb6f1d28e946a6a92f9a9ea288ce7b22e00c">' +
                            '<div itemscope itemtype="//refin.io/Person">' +
                                '<span itemprop="email">Asomeone@somewhere.org</span>' +
                            '</div>' +
                        '</span>' +
                    '</li>' +
                '</ul>' +
                '<ul itemprop="to">' +
                    '<li>' +
                        '<span itemprop="to" data-hash="6f68602adb950472d8240bd3472d537a11a99aa038716f790dfabde66f75599a" data-id-hash="41239e75cac3c286c562f0bbbfd7b469d4c723d8f4de3d85eabcc1b97b64a0d2">' +
                            '<div itemscope itemtype="//refin.io/Person">' +
                                '<span itemprop="email">Bsomeother@someother.com</span>' +
                            '</div>' +
                        '</span>' +
                    '</li>' +
                    '<li>' +
                        '<span itemprop="to" data-hash="bc037bb3e677f950bad50ce2a09b40887b8cd0629b986468d6ca5973f23c75d4" data-id-hash="334eac40a8f45896420216136a53ccdbc31ec89fbde58d6a36376c2c4e7b2acd">' +
                            '<div itemscope itemtype="//refin.io/Person">' +
                                '<span itemprop="email">Cyetanother@somewhereelse.com</span>' +
                            '</div>' +
                        '</span>' +
                    '</li>' +
                '</ul>' +
                '<span itemprop="date">1438418318011</span>' +
                '<span itemprop="subject">' +
                    'UNIQUE SUBJECT MAKES THIS FILE UNIQUE 455a95dae395c5ac4350c587197774fa77046f' +
                '</span>' +
                `<span itemprop="html" data-hash="${email.obj.html}">` +
                    escapeForHtml(await readUTF8TextFile(email.obj.html)) +
                '</span>' +
                '<ul itemprop="attachment">' +
                    '<li>' +
                        `<span itemprop="attachment" data-hash="${email.obj.attachment[idx1]}">` +
                            (await readBlobAsBase64(email.obj.attachment[idx1])) +
                        '</span>' +
                    '</li>' +
                    '<li>' +
                        `<span itemprop="attachment" data-hash="${email.obj.attachment[idx2]}">` +
                            (await readBlobAsBase64(email.obj.attachment[idx2])) +
                        '</span>' +
                    '</li>' +
                '</ul>' +
            '</div>';

        mascha = await storeUnversionedObject({
            $type$: 'OneTest$Matryoschka',
            name: 'Mascha',
            child: []
        });
        wascha = await storeUnversionedObject({
            $type$: 'OneTest$Matryoschka',
            name: 'Wascha',
            child: []
        });

        sascha = await storeUnversionedObject({
            $type$: 'OneTest$Matryoschka',
            name: 'Sascha',
            child: [mascha.hash, wascha.hash]
        });

        tascha = await storeUnversionedObject({
            $type$: 'OneTest$Matryoschka',
            name: 'Tascha',
            child: [sascha.hash]
        });

        nascha = await storeUnversionedObject(
            {
                $type$: 'OneTest$Matryoschka',
                name: 'Nascha',
                child: [tascha.hash]
            }
            // {
            //     $type$: 'OneTest$Matryoschka',
            //     name: 'Nascha',
            //     child: [
            //         {
            //             $type$: 'OneTest$Matryoschka',
            //             name: 'Tascha',
            //             child: [
            //                 {
            //                     $type$: 'OneTest$Matryoschka',
            //                     name: 'Sascha',
            //                     child: [mascha.obj, wascha.obj]
            //                 }
            //             ]
            //         }
            //     ]
            // }
        );
    });

    after(async () => {
        await closeAndDeleteCurrentInstance();
        stopLogger();
    });

    it('should explode a OneTest$Email microdata ONE object', async () => {
        const result = await explode(emailImploded);
        expect(result.obj).to.deep.equal({
            ...email.obj,
            to: email.obj.to?.sort()
        });
    });

    it('should explode a OneTest$ChannelInfo microdata ONE object', async () => {
        const result = await explode(wbcObservationChannelInfoImploded);
        expect(result.obj).to.deep.equal({
            ...wbcObservationChannelInfo.obj
        });
    });

    it('should FAIL to explode a OneTest$ChannelInfo microdata ONE object', async () => {
        // Inner object with two non-optional properties
        // <div itemprop="Leukocytes">
        //     <span itemprop="value">1</span>
        //     <span itemprop="unit"></span>
        // </div>
        const invalidMicrodata = wbcObservationChannelInfoImploded.replace(
            '<span itemprop="unit"></span>',
            ''
        );

        try {
            await explode(invalidMicrodata);
            expect(true).to.equal(false);
        } catch (err) {
            expect(err).to.be.instanceof(Error);
            expect(err.code).to.equal('O2M-RTYC2');
            expect(err.message).to.include('O2M-RTYC2: Mandatory property "unit" missing');
        }
    });

    it('should explode an object AND recurse to to save included objects', async () => {
        const result = await explode(createNaschaImploded(tascha, sascha, wascha, mascha));
        expect(result.obj).to.deep.equal(nascha.obj);
    });

    it('should explode the included object from microdata', async () => {
        const microdata =
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$UnversionedReferenceTest">' +
                '<span itemprop="ref" data-hash="450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6">' +
                    '<div itemscope itemtype="//refin.io/Person">' +
                        '<span itemprop="email">Asomeone@somewhere.org</span>' +
                    '</div>' +
                '</span>' +
                '<span itemprop="str">Some String</span>' +
            '</div>';

        const exploded = await explode(microdata);

        expect(exploded).to.deep.equal({
            obj: {
                $type$: 'OneTest$UnversionedReferenceTest',
                ref: '450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6',
                str: 'Some String'
            },
            hash: '28a174e7113655aed7e41c5ca19c0a8b2da7c6bda03a19c49f3c5413612acb21',
            status: 'new'
        });
    });

    it('should explode the included ID object from microdata', async () => {
        // const testPersonResult = await storeVersionedObject(
        //     {$type$: 'Person', email: 'randomEmail'}
        // );
        // const miniProfileResult = await storeUnversionedObject({
        //     $type$: 'MiniProfile',
        //     owner: testPersonResult.idHash
        // });
        // const implodedMiniProfileMicrodata = await implode(miniProfileResult.hash);

        const implodedMiniProfileMicrodata =
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/MiniProfile">' +
                '<span itemprop="owner" ' +
                'data-hash="24f58c5584b90bdfa234a3e4f9a509eb9e15b466ea086fbaa088002edadf4afc" ' +
                'data-id-hash="69b02c4d915a5902f39fb5584168bfdc0b9b0f5d7a2cb3e0269556d1ed708fcd">' +
                    '<div itemscope itemtype="//refin.io/Person">' +
                        '<span itemprop="email">randomEmail</span>' +
                    '</div>' +
                '</span>' +
            '</div>';

        const explodedMiniProfile = await explode(implodedMiniProfileMicrodata);

        expect({
            hash: explodedMiniProfile.hash,
            idHash: explodedMiniProfile.idHash,
            status: explodedMiniProfile.status,
            timestamp: explodedMiniProfile.timestamp,
            obj: explodedMiniProfile.obj
        }).to.deep.equal({
            obj: {
                $type$: 'MiniProfile',
                owner: '69b02c4d915a5902f39fb5584168bfdc0b9b0f5d7a2cb3e0269556d1ed708fcd'
            },
            hash: '0c5a14d1db83ff863c0f3379062b94f6adfa06aca60c8d63a39a8bd894c1932d',
            idHash: '17ac0b38ebfd501910721a054d02cacf16df5468ceb08c80fd97f93e0f026ec2',
            status: 'new',
            timestamp: explodedMiniProfile.timestamp // This varies and is not important
        });
    });
});
