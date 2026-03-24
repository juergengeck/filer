/* eslint-disable no-console */

import {expect} from 'chai';

import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import * as MicrodataImploder from '../../lib/microdata-imploder.js';
import {convertObjToMicrodata, escapeForHtml} from '../../lib/object-to-microdata.js';
import type {Group, Person} from '../../lib/recipes.js';
import {readBlobAsBase64, storeUTF8Clob} from '../../lib/storage-blob.js';
import type {UnversionedObjectResult} from '../../lib/storage-unversioned-objects.js';
import {storeUnversionedObject} from '../../lib/storage-unversioned-objects.js';
import type {VersionedObjectResult} from '../../lib/storage-versioned-objects.js';
import {storeVersionedObject} from '../../lib/storage-versioned-objects.js';
import {readUTF8TextFile} from '../../lib/system/storage-base.js';
import {createFileWriteStream} from '../../lib/system/storage-streams.js';
import type {SHA256Hash} from '../../lib/util/type-checks.js';
import type {HexString} from '../../lib/util/arraybuffer-to-and-from-hex-string.js';

import {init} from './_helpers.js';
import type {
    OneTest$AffirmationCertificate,
    OneTest$ChannelEntry,
    OneTest$ChannelInfo,
    OneTest$CreationTime,
    OneTest$Email,
    OneTest$ImploderRecipe,
    OneTest$Matryoschka,
    OneTest$NestedReferenceTest,
    OneTest$Signature,
    OneTest$UnversionedReferenceTest,
    OneTest$WbcObservation
} from './_register-types.js';

async function createTestObjects(): Promise<
    [
        VersionedObjectResult<Person>,
        VersionedObjectResult<Person>,
        VersionedObjectResult<Person>,
        VersionedObjectResult<OneTest$Email>,
        UnversionedObjectResult<OneTest$ImploderRecipe>,
        VersionedObjectResult<Group>,
        UnversionedObjectResult<OneTest$UnversionedReferenceTest>,
        UnversionedObjectResult<OneTest$WbcObservation>,
        UnversionedObjectResult<OneTest$Signature>,
        UnversionedObjectResult<OneTest$AffirmationCertificate>,
        UnversionedObjectResult<OneTest$CreationTime>,
        UnversionedObjectResult<OneTest$ChannelEntry>,
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

`.repeat(4)
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
        uint8Array[j] = j % 255;
    }

    blob2Stream.write(uint8Array.buffer);

    const blob2Result = await blob2Stream.end();

    const imploderTestPersonResult = await storeVersionedObject({
        $type$: 'Person',
        email: 'imploder@test.com'
    });

    const person1 = await storeVersionedObject({$type$: 'Person', email: 'Asomeone@somewhere.org'});
    const person2 = await storeVersionedObject({
        $type$: 'Person',
        email: 'Bsomeother@someother.com'
    });
    const person3 = await storeVersionedObject({
        $type$: 'Person',
        email: 'Cyetanother@somewhereelse.com'
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

    return [
        person1,
        person2,
        person3,
        await storeVersionedObject({
            $type$: 'OneTest$Email',
            messageID: 'dummy-123.123@dummy.com',
            from: [person1.idHash],
            to: [person2.idHash, person3.idHash],
            date: 1438418318011,
            subject: 'UNIQUE SUBJECT MAKES THIS FILE UNIQUE 455a95dae395c5ac4350c587197774fa77046f',
            html: clobResult.hash,
            attachment: [blob1Result.hash, blob2Result.hash]
        }),
        await storeUnversionedObject({
            $type$: 'OneTest$ImploderRecipe',
            prop1: 'foobar',
            nestedObject: [
                {
                    nestedProp1: 'barfoo',
                    nestedReference: imploderTestPersonResult.hash
                }
            ]
        }),
        await storeVersionedObject({
            $type$: 'Group',
            name: 'TestGroup',
            person: [person1.idHash]
        }),
        await storeUnversionedObject({
            $type$: 'OneTest$UnversionedReferenceTest',
            ref: person1.hash,
            str: 'Some String'
        }),
        wbcObservation,
        wbcObservationSignature,
        wbcObservationAffirmationCertificate,
        wbcObservationCreationTime,
        wbcObservationChannelEntry,
        wbcObservationChannelInfo
    ];
}

// Overwrite the storage method so that the test does not actually store anything.
describe('Microdata Imploder tests', () => {
    // const p1 = {$type$: 'Person', email: 'Asomeone@somewhere.org'};
    // const p2 = {$type$: 'Person', email: 'Bsomeother@someother.com'};
    // const p3 = {$type$: 'Person', email: 'Cyetanother@somewhereelse.com'};
    // const emailImplodedObj = {
    //     $type$: 'OneTest$Email',
    //     messageID: 'dummy-123.123@dummy.com',
    //     from: [p1],
    //     to: [p2, p3],
    //     date: 1438418318011,
    //     subject: 'UNIQUE SUBJECT MAKES THIS FILE UNIQUE 455a95dae395c5ac4350c587197774fa77046f',
    //     attachment: [
    //         '7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71',
    //         'd621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965'
    //     ],
    // };
    const maschaObj = {$type$: 'OneTest$Matryoschka', name: 'Mascha'} as const;
    const waschaObj = {$type$: 'OneTest$Matryoschka', name: 'Wascha'} as const;
    // const naschaImplodedObj = {
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
    //                     child: [maschaObj,   waschaObj]
    //                 }
    //             ]
    //         }
    //     ]
    // };

    let person1: VersionedObjectResult<Person>,
        person2: VersionedObjectResult<Person>,
        person3: VersionedObjectResult<Person>,
        email: VersionedObjectResult<OneTest$Email>,
        imploder: UnversionedObjectResult<OneTest$ImploderRecipe>,
        group: VersionedObjectResult<Group>,
        ref: UnversionedObjectResult<OneTest$UnversionedReferenceTest>,
        nascha: UnversionedObjectResult<OneTest$Matryoschka>,
        mascha: UnversionedObjectResult<OneTest$Matryoschka>,
        wascha: UnversionedObjectResult<OneTest$Matryoschka>,
        sascha: UnversionedObjectResult<OneTest$Matryoschka>,
        tascha: UnversionedObjectResult<OneTest$Matryoschka>,
        nestedTestObj: UnversionedObjectResult<OneTest$NestedReferenceTest>,
        wbcObservationChannelInfoImploded: string,
        _wbcObservation: UnversionedObjectResult<OneTest$WbcObservation>,
        _wbcObservationCreationTime: UnversionedObjectResult<OneTest$CreationTime>,
        wbcObservationChannelInfo: VersionedObjectResult<OneTest$ChannelInfo>,
        _wbcObservationChannelEntry: UnversionedObjectResult<OneTest$ChannelEntry>,
        _wbcObservationSignature: UnversionedObjectResult<OneTest$Signature>,
        _wbcObservationAffirmationCertificate: UnversionedObjectResult<OneTest$AffirmationCertificate>;

    // For this test replace these storage functions so that we don't actually go
    // to storage. Replace the replacement with the original in after().
    // eslint-disable-next-line no-console
    before(async () => {
        startLogger({includeInstanceName: true, types: ['error']});

        await init();

        [
            person1,
            person2,
            person3,
            email,
            imploder,
            group,
            ref,
            _wbcObservation,
            _wbcObservationSignature,
            _wbcObservationAffirmationCertificate,
            _wbcObservationCreationTime,
            _wbcObservationChannelEntry,
            wbcObservationChannelInfo
        ] = await createTestObjects();

        mascha = await storeUnversionedObject(maschaObj);
        wascha = await storeUnversionedObject(waschaObj);

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

        nascha = await storeUnversionedObject({
            $type$: 'OneTest$Matryoschka',
            name: 'Nascha',
            child: [tascha.hash]
        });

        nestedTestObj = await storeUnversionedObject({
            $type$: 'OneTest$NestedReferenceTest',
            name: 'Top Level',
            reference: [person1.hash, person2.hash, person3.hash],
            preorderedReferenceItem: [
                {
                    // SUB-TEST: Same name as a property in the parent layer
                    name: 'Preordered nested Reference 1',
                    nestedReference1: [person1.hash, person2.hash, person3.hash]
                },
                {
                    name: 'Preordered nested Reference 2',
                    nestedReference1: [person3.hash, person2.hash, person1.hash]
                }
            ],
            unorderedReferenceItem: [
                {
                    name: 'Unordered nested Reference 1',
                    nestedReference2: [person1.hash, person2.hash, person3.hash]
                },
                {
                    name: 'Unordered nested Reference 2',
                    nestedReference2: [person3.hash, person2.hash, person1.hash]
                }
            ]
        });

        wbcObservationChannelInfoImploded =
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
                                        '<span itemprop="signature">011441140bd296f5bf8213252cfc6f027e76dc84bd14fc7bff691ece359bd5f908cb472bae7fb050fb38d1eb66beb1ae63d3f25f26114e554fb646eba732af0a</span>' +
                                    '</div>' +
                                '</span>' +
                            '</li>' +
                        '</ul>' +
                    '</div>' +
                '</span>' +
            '</div>';
    });

    after(async () => {
        await closeAndDeleteCurrentInstance();
        stopLogger();
    });

    it('should find all Reference objects in a nested ONE object', async () => {
        const microdata1 = await readUTF8TextFile(email.hash);
        const ref1 = MicrodataImploder.findAllReferenceHashes(microdata1);

        if (email.obj.attachment === undefined) {
            throw new Error('no attachment');
        }

        if (email.obj.html === undefined) {
            throw new Error('no html');
        }
        // expect(typeof o.start).to.equal('number');
        // expect(typeof o.end).to.equal('number');
        expect([...ref1.mapObj]).to.deep.equal([
            [
                'from',
                [
                    {
                        start: 132,
                        end: 218,
                        hash: 'd8f2defb84c5ed89463e9679e2a2bb6f1d28e946a6a92f9a9ea288ce7b22e00c',
                        hashLinkType: 'id'
                    }
                ]
            ],
            [
                'to',
                [
                    {
                        start: 250,
                        end: 336,
                        hash: '334eac40a8f45896420216136a53ccdbc31ec89fbde58d6a36376c2c4e7b2acd',
                        hashLinkType: 'id'
                    },
                    {
                        start: 345,
                        end: 431,
                        hash: '41239e75cac3c286c562f0bbbfd7b469d4c723d8f4de3d85eabcc1b97b64a0d2',
                        hashLinkType: 'id'
                    }
                ]
            ],
            [
                'html',
                [
                    {
                        start: 591,
                        end: 695,
                        hash: '2912d75df5a21365ff6af395308f8f7fc978cd4ba68a8847d0fa85cc00317b6c',
                        hashLinkType: 'clob'
                    }
                ]
            ],
            [
                'attachment',
                [
                    {
                        start: 725,
                        end: 813,
                        hash: '4f374557bf44bb12ba2663f8a84e9515165a2332c1f3059d6d81dfe1379eb77b',
                        hashLinkType: 'blob'
                    },
                    {
                        start: 822,
                        end: 910,
                        hash: 'e53761c6869a9f64d6a5aa8d064d111b89589fa5cc690019eca93707e084102f',
                        hashLinkType: 'blob'
                    }
                ]
            ]
        ]);

        const microdata2 = await readUTF8TextFile(nestedTestObj.hash);
        const ref2 = MicrodataImploder.findAllReferenceHashes(microdata2);

        expect([...ref2.mapObj]).to.deep.equal([
            [
                'reference',
                [
                    {
                        start: 132,
                        end: 219,
                        hash: '450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 228,
                        end: 315,
                        hash: '6f68602adb950472d8240bd3472d537a11a99aa038716f790dfabde66f75599a',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 324,
                        end: 411,
                        hash: 'bc037bb3e677f950bad50ce2a09b40887b8cd0629b986468d6ca5973f23c75d4',
                        hashLinkType: 'obj'
                    }
                ]
            ],
            [
                'nestedReference1',
                [
                    {
                        start: 563,
                        end: 650,
                        hash: '450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 659,
                        end: 746,
                        hash: '6f68602adb950472d8240bd3472d537a11a99aa038716f790dfabde66f75599a',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 755,
                        end: 842,
                        hash: 'bc037bb3e677f950bad50ce2a09b40887b8cd0629b986468d6ca5973f23c75d4',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 966,
                        end: 1053,
                        hash: '450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 1062,
                        end: 1149,
                        hash: '6f68602adb950472d8240bd3472d537a11a99aa038716f790dfabde66f75599a',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 1158,
                        end: 1245,
                        hash: 'bc037bb3e677f950bad50ce2a09b40887b8cd0629b986468d6ca5973f23c75d4',
                        hashLinkType: 'obj'
                    }
                ]
            ],
            [
                'nestedReference2',
                [
                    {
                        start: 1411,
                        end: 1498,
                        hash: '450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 1507,
                        end: 1594,
                        hash: '6f68602adb950472d8240bd3472d537a11a99aa038716f790dfabde66f75599a',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 1603,
                        end: 1690,
                        hash: 'bc037bb3e677f950bad50ce2a09b40887b8cd0629b986468d6ca5973f23c75d4',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 1813,
                        end: 1900,
                        hash: '450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 1909,
                        end: 1996,
                        hash: '6f68602adb950472d8240bd3472d537a11a99aa038716f790dfabde66f75599a',
                        hashLinkType: 'obj'
                    },
                    {
                        start: 2005,
                        end: 2092,
                        hash: 'bc037bb3e677f950bad50ce2a09b40887b8cd0629b986468d6ca5973f23c75d4',
                        hashLinkType: 'obj'
                    }
                ]
            ]
        ]);
    });

    // it('should return unchanged an object that has no references', async () => {
    //     expect(
    //         await MicrodataImploder.implode(emailImplodedObj.hash)
    //     )
    //     .to.equal(
    //         convertObjToMicrodata(emailImplodedObj)
    //     );
    //
    //     expect(
    //         await MicrodataImploder.implode(naschaImplodedObj.hash)
    //     )
    //     .to.equal(
    //         convertObjToMicrodata(naschaImplodedObj)
    //     );
    // });

    it('should implode a OneTest$Email microdata ONE object', async () => {
        if (email.obj.attachment === undefined) {
            throw new Error('no attachment');
        }

        if (email.obj.html === undefined) {
            throw new Error('no html');
        }

        const [idx1, idx2] = email.obj.attachment[0] < email.obj.attachment[1] ? [0, 1] : [1, 0];

        const result = await MicrodataImploder.implode(email.hash);
        expect(result).to.equal(
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
                        '<span itemprop="to" data-hash="bc037bb3e677f950bad50ce2a09b40887b8cd0629b986468d6ca5973f23c75d4" data-id-hash="334eac40a8f45896420216136a53ccdbc31ec89fbde58d6a36376c2c4e7b2acd">' +
                            '<div itemscope itemtype="//refin.io/Person">' +
                                '<span itemprop="email">Cyetanother@somewhereelse.com</span>' +
                            '</div>' +
                        '</span>' +
                    '</li>' +
                    '<li>' +
                        '<span itemprop="to" data-hash="6f68602adb950472d8240bd3472d537a11a99aa038716f790dfabde66f75599a" data-id-hash="41239e75cac3c286c562f0bbbfd7b469d4c723d8f4de3d85eabcc1b97b64a0d2">' +
                            '<div itemscope itemtype="//refin.io/Person">' +
                                '<span itemprop="email">Bsomeother@someother.com</span>' +
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
            '</div>'
        );
    });

    it('should implode a OneTest$WbcObservation OneTest$ChannelInfo microdata ONE object', async () => {
        const planResults = await MicrodataImploder.implode(wbcObservationChannelInfo.hash);
        expect(planResults).to.equal(wbcObservationChannelInfoImploded);
    });

    it('should implode a Group microdata ONE object', async () => {
        const result = await MicrodataImploder.implode(group.hash);
        expect(result).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/Group">' +
                '<span itemprop="name">TestGroup</span>' +
                '<ul itemprop="person">' +
                    '<li>' +
                        '<span itemprop="person" ' +
                            'data-hash="450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6" ' +
                            'data-id-hash="d8f2defb84c5ed89463e9679e2a2bb6f1d28e946a6a92f9a9ea288ce7b22e00c">' +
                            '<div itemscope itemtype="//refin.io/Person">' +
                                '<span itemprop="email">Asomeone@somewhere.org</span>' +
                            '</div>' +
                        '</span>' +
                    '</li>' +
                '</ul>' +
            '</div>'
        );
    });

    it('should implode a OneTest$UnversionedReferenceTest microdata ONE object', async () => {
        const result = await MicrodataImploder.implode(ref.hash);
        expect(result).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$UnversionedReferenceTest">' +
                '<span itemprop="ref" data-hash="450e1441dbf5b609c18fb694d0e7e3c37baa1ce9b4c9ecdaabc03c281e462ef6">' +
                    '<div itemscope itemtype="//refin.io/Person">' +
                        '<span itemprop="email">Asomeone@somewhere.org</span>' +
                    '</div>' +
                '</span>' +
                '<span itemprop="str">Some String</span>' +
            '</div>'
        );
    });

    it('should implode an object AND recurse to include an object referenced by an included object', async () => {
        expect(await MicrodataImploder.implode(nascha.hash)).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$Matryoschka">' +
                '<span itemprop="name">Nascha</span>' +
                '<ul itemprop="child">' +
                    '<li>' +
                        '<span itemprop="child" data-hash="e45c163c7ff34eada7821faa336b045e5f937e4495dc8e911cc7ed2eb2e03712">' +
                            '<div itemscope itemtype="//refin.io/OneTest$Matryoschka">' +
                                '<span itemprop="name">Tascha</span>' +
                                '<ul itemprop="child">' +
                                    '<li>' +
                                        '<span itemprop="child" data-hash="5dd4976fa08359b06405c260a54fc703fa0d51bb68b1ffef79c6e4a3a5e213c6">' +
                                            '<div itemscope itemtype="//refin.io/OneTest$Matryoschka">' +
                                                '<span itemprop="name">Sascha</span>' +
                                                '<ul itemprop="child">' +
                                                    '<li>' +
                                                        '<span itemprop="child" data-hash="610e584b3e1e85bbeeb480d2b4a35ed6fedb374a96b7cd398948dc435fd13ab6">' +
                                                            '<div itemscope itemtype="//refin.io/OneTest$Matryoschka">' +
                                                                '<span itemprop="name">Wascha</span>' +
                                                            '</div>' +
                                                        '</span>' +
                                                    '</li>' +
                                                    '<li>' +
                                                        '<span itemprop="child" data-hash="840a6f7b04ffdeee92a9eec2b66de4684b4a905bc80485754bd0ba78a9396779">' +
                                                            '<div itemscope itemtype="//refin.io/OneTest$Matryoschka">' +
                                                                '<span itemprop="name">Mascha</span>' +
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
    });

    it('should handle an object with nothing to implode', async () => {
        expect(await MicrodataImploder.implode(person1.hash)).to.equal(
            convertObjToMicrodata(person1.obj)
        );
    });

    it('should return FileNotFound error if the given hash does not exist', async () => {
        try {
            await MicrodataImploder.implode(
                '000000000000000000000000000000000fffffffffffffffffffffffffffffff' as SHA256Hash
            );
            expect(false).to.equal(true);
        } catch (err) {
            expect(err.name).to.equal('FileNotFoundError');
            expect(err.message).to.include(
                'File not found: 000000000000000000000000000000000fffffffffffffffffffffffffffffff [objects]'
            );
        }
    });

    it('Should test the imploder', async () => {
        const implodedObject = await MicrodataImploder.implode(imploder.hash);

        expect(implodedObject);
    });
});
