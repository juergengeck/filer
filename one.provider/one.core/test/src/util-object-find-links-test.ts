/* eslint-disable @typescript-eslint/no-unsafe-call */

import {expect} from 'chai';
import {convertMicrodataToObject} from '../../lib/microdata-to-object.js';

import {addCoreRecipesToRuntime, clearRuntimeRecipes} from '../../lib/object-recipes.js';
import type {BLOB, CLOB} from '../../lib/recipes.js';
import {createCryptoHash} from '../../lib/system/crypto-helpers.js';
import {SYSTEM} from '../../lib/system/platform.js';
import {
    findLinkedHashesInObject,
    findLinkedHashesWithValueTypeInObject
} from '../../lib/util/object-find-links.js';
import {stringify} from '../../lib/util/sorted-stringify.js';
import type {SHA256Hash} from '../../lib/util/type-checks.js';
import {ensureHash, ensureIdHash} from '../../lib/util/type-checks.js';

import type {OneTest$Email, OneTest$ReferenceTest} from './_register-types.js';
import {addTestTypes} from './_register-types.js';

// The simulated filesystem
const files: Record<SHA256Hash, string> = {};

const testMicrodata = [
    '<div itemscope itemtype="//refin.io/OneTest$Email">',
    '<span itemprop="messageID">dummy-123.123@dummy.com</span>',
    '<ul itemprop="from">',
    '<li>',
    '<a data-type="id"' +
        '>' +
        'cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184' +
        '</a>',
    '</li>',
    '</ul>',
    '<ul itemprop="to">',
    '<li>',
    '<a data-type="id"' +
        '>' +
        '1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184' +
        '</a>',
    '</li>',
    '<li>',
    '<a data-type="id"' +
        '>' +
        'aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208' +
        '</a>',
    '</li>',
    '</ul>',
    '<span itemprop="date">1438418318000</span>',
    '<span itemprop="subject">Zwei Anhänge</span>',
    '<a itemprop="html" data-type="clob">' +
        '7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4' +
        '</a>',
    '<a itemprop="text" data-type="blob">' +
        '0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a' +
        '</a>',
    '<ul itemprop="attachment">',
    '<li>' +
        '<a data-type="blob">' +
        '7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71' +
        '</a>' +
        '</li>' +
        '<li>' +
        '<a data-type="blob">' +
        'd621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965' +
        '</a>',
    '</li>',
    '</ul>',
    '<a itemprop="rawEmail" data-type="blob">' +
        '59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95' +
        '</a>',
    '</div>'
].join('');

let testMicrodataHash: SHA256Hash<OneTest$Email>;

const refTestObj: OneTest$ReferenceTest = {
    $type$: 'OneTest$ReferenceTest',
    versionedRef: [ensureHash('96b88fae53f592899aa81b1f406ef05cd20630e6119b2589a034996562e63544')],
    unversionedRef: [
        ensureHash('63458d0ffd052c2dae1283a86f443be67ffc55544382d4c5cc28946c5725d0d1'),
        ensureHash('b434d5c0b11d867a54a14d50e3ec476e3e806d4b133f1a96deed518af853b784'),
        ensureHash('5662e0e416171d7702f8e1832c2376393f45e8ab0af4024c7fbeaf01658da35e')
    ],
    idRef: [
        ensureIdHash('7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3'),
        ensureIdHash('51bb2ec3a48532dbf8922cc73b10638c2698783eee4ee9cb081328093b09fb45')
    ],
    clob: [
        ensureHash<CLOB>('f146357922940cac14f7d7854d7644785d4b30d570e4b1e74bfe08b09b0f80f6'),
        ensureHash<CLOB>('8a00bb61caa1a995d45fa82f8061af9e1c6daf384e46e43166b6876fd6d25219')
    ],
    blob: [
        ensureHash<BLOB>('4a2094ab1418294f1856e63f77e63d867b1f938e8c5e25129dc50b15f3807803'),
        ensureHash<BLOB>('7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71'),
        ensureHash<BLOB>('d621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965')
    ],
    mapRef: new Map([
        [
            ensureIdHash('8a2094ab1418294f1856e63f77e63d867b1f938e8c5e25129dc50b15f3807803'),
            ensureHash('8bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71')
        ],
        [
            ensureIdHash('9a2094ab1418294f1856e63f77e63d867b1f938e8c5e25129dc50b15f3807803'),
            ensureHash('9bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71')
        ]
    ])
};

// TODO implement more complex tests for this. ESPECIALLY deeper nested ones. Right now all
//  returned results are on the top level. Hash links deeper than top level have the format
//  "prop1.prop2.prop3" in "itemprop".

describe('Object find references tests', () => {
    // Make sure the test file about to be created does not exist yet. We can just
    // blindly delete it because the name is the crypto hash of content that won't
    // occur anywhere else and is therefore unique to this test.
    before(async () => {
        await import(`../../lib/system/load-${SYSTEM}.js`);
        addCoreRecipesToRuntime();
        addTestTypes();
        testMicrodataHash = await createCryptoHash(testMicrodata);
        files[testMicrodataHash] = testMicrodata;
    });
    after(clearRuntimeRecipes);

    // It has an ID reference
    it('should find all links in a OneTest$ReferenceTest object (hash)', () => {
        expect(findLinkedHashesInObject(refTestObj)).to.deep.equal({
            references: [
                '96b88fae53f592899aa81b1f406ef05cd20630e6119b2589a034996562e63544',
                '63458d0ffd052c2dae1283a86f443be67ffc55544382d4c5cc28946c5725d0d1',
                'b434d5c0b11d867a54a14d50e3ec476e3e806d4b133f1a96deed518af853b784',
                '5662e0e416171d7702f8e1832c2376393f45e8ab0af4024c7fbeaf01658da35e',
                '8bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71',
                '9bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71'
            ],
            idReferences: [
                '7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3',
                '51bb2ec3a48532dbf8922cc73b10638c2698783eee4ee9cb081328093b09fb45',
                '8a2094ab1418294f1856e63f77e63d867b1f938e8c5e25129dc50b15f3807803',
                '9a2094ab1418294f1856e63f77e63d867b1f938e8c5e25129dc50b15f3807803'
            ],
            blobs: [
                '4a2094ab1418294f1856e63f77e63d867b1f938e8c5e25129dc50b15f3807803',
                '7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71',
                'd621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965'
            ],
            clobs: [
                'f146357922940cac14f7d7854d7644785d4b30d570e4b1e74bfe08b09b0f80f6',
                '8a00bb61caa1a995d45fa82f8061af9e1c6daf384e46e43166b6876fd6d25219'
            ]
        });
    });

    // It has an ID reference
    it('should find all links in a OneTest$ReferenceTest object (hash and itemprop)', () => {
        expect(stringify(findLinkedHashesWithValueTypeInObject(refTestObj))).to.equal(
            stringify({
                references: [
                    {
                        hash: '96b88fae53f592899aa81b1f406ef05cd20630e6119b2589a034996562e63544',
                        valueType: {
                            allowedTypes: new Set('*'),
                            type: 'referenceToObj'
                        }
                    },
                    {
                        hash: '63458d0ffd052c2dae1283a86f443be67ffc55544382d4c5cc28946c5725d0d1',
                        valueType: {
                            allowedTypes: new Set('*'),
                            type: 'referenceToObj'
                        }
                    },
                    {
                        hash: 'b434d5c0b11d867a54a14d50e3ec476e3e806d4b133f1a96deed518af853b784',
                        valueType: {
                            allowedTypes: new Set('*'),
                            type: 'referenceToObj'
                        }
                    },
                    {
                        hash: '5662e0e416171d7702f8e1832c2376393f45e8ab0af4024c7fbeaf01658da35e',
                        valueType: {
                            allowedTypes: new Set('*'),
                            type: 'referenceToObj'
                        }
                    },
                    {
                        hash: '8bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71',
                        valueType: {
                            allowedTypes: new Set('*'),
                            type: 'referenceToObj'
                        }
                    },
                    {
                        hash: '9bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71',
                        valueType: {
                            allowedTypes: new Set('*'),
                            type: 'referenceToObj'
                        }
                    }
                ],
                idReferences: [
                    {
                        hash: '7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3',
                        valueType: {
                            allowedTypes: new Set('*'),
                            type: 'referenceToId'
                        }
                    },
                    {
                        hash: '51bb2ec3a48532dbf8922cc73b10638c2698783eee4ee9cb081328093b09fb45',
                        valueType: {
                            allowedTypes: new Set('*'),
                            type: 'referenceToId'
                        }
                    },
                    {
                        hash: '8a2094ab1418294f1856e63f77e63d867b1f938e8c5e25129dc50b15f3807803',
                        valueType: {
                            allowedTypes: new Set('*'),
                            type: 'referenceToId'
                        }
                    },
                    {
                        hash: '9a2094ab1418294f1856e63f77e63d867b1f938e8c5e25129dc50b15f3807803',
                        valueType: {
                            allowedTypes: new Set('*'),
                            type: 'referenceToId'
                        }
                    }
                ],
                blobs: [
                    {
                        hash: '4a2094ab1418294f1856e63f77e63d867b1f938e8c5e25129dc50b15f3807803',
                        valueType: {
                            type: 'referenceToBlob'
                        }
                    },
                    {
                        hash: '7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71',
                        valueType: {
                            type: 'referenceToBlob'
                        }
                    },
                    {
                        hash: 'd621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965',
                        valueType: {
                            type: 'referenceToBlob'
                        }
                    }
                ],
                clobs: [
                    {
                        hash: 'f146357922940cac14f7d7854d7644785d4b30d570e4b1e74bfe08b09b0f80f6',
                        valueType: {
                            type: 'referenceToClob'
                        }
                    },
                    {
                        hash: '8a00bb61caa1a995d45fa82f8061af9e1c6daf384e46e43166b6876fd6d25219',
                        valueType: {
                            type: 'referenceToClob'
                        }
                    }
                ]
            })
        );
    });

    // Test nested object
    // Test nested object

    it('should extract Reference objects from OneTest$Email object (hash)', async () => {
        const allLinks = findLinkedHashesInObject(
            convertMicrodataToObject(files[testMicrodataHash])
        );

        expect(allLinks.idReferences).to.deep.equal([
            'cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184',
            '1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184',
            'aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208'
        ]);
    });

    it('should extract Reference objects from OneTest$Email object (hash and itemprop)', async () => {
        const obj = convertMicrodataToObject(files[testMicrodataHash]);
        const allLinks = findLinkedHashesWithValueTypeInObject(obj);

        expect(stringify(allLinks)).to.equal(
            stringify({
                references: [],
                idReferences: [
                    {
                        hash: ensureHash(
                            'cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184'
                        ),
                        valueType: {
                            allowedTypes: new Set(['Person']),
                            type: 'referenceToId'
                        }
                    },
                    {
                        hash: ensureHash(
                            '1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184'
                        ),
                        valueType: {
                            allowedTypes: new Set(['Person']),
                            type: 'referenceToId'
                        }
                    },
                    {
                        hash: ensureHash(
                            'aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208'
                        ),
                        valueType: {
                            allowedTypes: new Set(['Person']),
                            type: 'referenceToId'
                        }
                    }
                ],
                blobs: [
                    {
                        hash: '0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        valueType: {
                            type: 'referenceToBlob'
                        }
                    },
                    {
                        hash: '7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71',
                        valueType: {
                            type: 'referenceToBlob'
                        }
                    },
                    {
                        hash: 'd621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965',
                        valueType: {
                            type: 'referenceToBlob'
                        }
                    },
                    {
                        hash: '59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95',
                        valueType: {
                            type: 'referenceToBlob'
                        }
                    }
                ],
                clobs: [
                    {
                        hash: '7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4',
                        valueType: {
                            type: 'referenceToClob'
                        }
                    }
                ]
            })
        );
    });
});
