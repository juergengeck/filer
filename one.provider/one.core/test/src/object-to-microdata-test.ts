import {expect} from 'chai';

import {addCoreRecipesToRuntime, clearRuntimeRecipes} from '../../lib/object-recipes.js';
import {convertObjToIdMicrodata, convertObjToMicrodata} from '../../lib/object-to-microdata.js';
import type {BLOB, CLOB, Person} from '../../lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '../../lib/util/type-checks.js';

import type {OneTest$TypeTest} from './_register-types.js';
import {addTestTypes} from './_register-types.js';

describe('Object to Microdata conversion tests', () => {
    before(() => {
        addCoreRecipesToRuntime();
        addTestTypes();
    });
    after(clearRuntimeRecipes);

    it('should convert JS "OneTest$Email" object to microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'OneTest$Email',
            messageID: 'dummy-123.123@dummy.com',
            // "from" is an array. TEST: Is the value automatically converted to an array?
            from: [
                'cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184' as SHA256IdHash<Person>
            ],
            to: [
                '1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184' as SHA256IdHash<Person>,
                'aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208' as SHA256IdHash<Person>
            ],
            subject: 'Zwei Anhänge',
            date: 1438418318001,
            rawEmail:
                '59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95' as SHA256Hash<BLOB>,
            html: '7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4' as SHA256Hash<CLOB>,
            text: '0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a' as SHA256Hash<BLOB>,
            attachment: [
                '7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71' as SHA256Hash<BLOB>,
                'd621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965' as SHA256Hash<BLOB>
            ]
        });

        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$Email">' +
                '<span itemprop="messageID">dummy-123.123@dummy.com</span>' +
                '<ul itemprop="from">' +
                    '<li>' +
                        '<a data-type="id">' +
                            'cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184' +
                        '</a>' +
                    '</li>' +
                '</ul>' +
                '<ul itemprop="to">' +
                    '<li>' +
                        '<a data-type="id">' +
                            '1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184' +
                        '</a>' +
                    '</li>' +
                    '<li>' +
                        '<a data-type="id">' +
                            'aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208' +
                        '</a>' +
                    '</li>' +
                '</ul>' +
                '<span itemprop="date">1438418318001</span>' +
                '<span itemprop="subject">Zwei Anhänge</span>' +
                '<a itemprop="html" data-type="clob">' +
                    '7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4' +
                '</a>' +
                '<a itemprop="text" data-type="blob">' +
                    '0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a' +
                '</a>' +
                '<ul itemprop="attachment">' +
                    '<li>' +
                        '<a data-type="blob">' +
                            '7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71' +
                        '</a>' +
                    '</li>' +
                    '<li>' +
                        '<a data-type="blob">' +
                            'd621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965' +
                        '</a>' +
                    '</li>' +
                '</ul>' +
                '<a itemprop="rawEmail" data-type="blob">' +
                    '59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95' +
                '</a>' +
            '</div>'
        );
        // Make sure that the microdata does not include the property used to identify ID objects
        expect(microdata).to.not.contain('data-id-object="true"');
    });

    it('should convert "Person" object to microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'Person',
            email: 'winfried@mail.com',
            name: undefined
        });

        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/Person">' +
                '<span itemprop="email">winfried@mail.com</span>' +
            '</div>'
        );
    });

    it('should convert "OneTest$TestVersioned" object to microdata', () => {
        // Tests an optional id property that is *not* missing (recipe says it's optional)
        const microdata1 = convertObjToMicrodata({
            $type$: 'OneTest$TestVersioned',
            id: ['id item 1', 'id item 2', 'id item 3'],
            data: ['item 1', 'item 2', 'item 3']
        });

        expect(microdata1).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$TestVersioned">' +
                '<ul itemprop="id">' +
                    '<li>"id item 1"</li><li>"id item 2"</li><li>"id item 3"</li>' +
                '</ul>' +
                '<ul itemprop="data">' +
                    '<li>"item 1"</li><li>"item 2"</li><li>"item 3"</li>' +
                '</ul>' +
            '</div>'
        );

        // Tests an id property that *is* missing (recipe says it's optional)
        const microdata2 = convertObjToMicrodata({
            $type$: 'OneTest$TestVersioned',
            data: ['item 1', 'item 2', 'item 3']
        });

        expect(microdata2).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$TestVersioned">' +
                '<ul itemprop="data">' +
                    '<li>"item 1"</li><li>"item 2"</li><li>"item 3"</li>' +
                '</ul>' +
            '</div>'
        );
    });

    it('should refuse to convert object with integer prop set to non-integer', () => {
        function createMicrodataFn(): () => string {
            return () =>
                convertObjToMicrodata({
                    $type$: 'OneTest$TypeTest',
                    integer: [4, 1.1]
                });
        }

        expect(createMicrodataFn()).to.throw(
            Error,
            'O2M-RTYC1: Value for itemprop "integer" should be of type "integer", Value: 1.1'
        );
    });

    it('should convert "OneTest$TypeTest" object (with array to json) to microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'OneTest$TypeTest',
            string: ['winfried \'win\'fried\' "winfried""', ''],
            boolean: [true, false],
            number: [123.123, 42, 1.2e23, 0.01],
            integer: [123, 42, 1, 0],
            map: [
                new Map(),
                new Map([
                    ['key1', 'value1'],
                    ['key2', 'value2']
                ])
            ],
            set: [new Set(), new Set([1, 2, 3])],
            // OBJECT IS AN ARRAY test
            // Always stored as single value even if "list" was set (which checks forbid)
            object: [
                {
                    array: [],
                    set: new Set([1, 2, 3]),
                    bar: 'foo',
                    map: new Map([
                        ['key1', 'value1'],
                        ['key2', 'value2']
                    ])
                },
                [1, 2, 3],
                42
            ]
        });
        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$TypeTest">' +
                '<ol itemprop="string">' +
                    '<li>winfried \'win\'fried\' "winfried""</li>' +
                    '<li></li>' +
                '</ol>' +
                '<ol itemprop="boolean">' +
                    '<li>true</li>' +
                    '<li>false</li>' +
                '</ol>' +
                '<ol itemprop="number">' +
                    '<li>123.123</li>' +
                    '<li>42</li>' +
                    '<li>1.2e+23</li>' +
                    '<li>0.01</li>' +
                '</ol>' +
                '<ol itemprop="integer">' +
                    '<li>123</li>' +
                    '<li>42</li>' +
                    '<li>1</li>' +
                    '<li>0</li>' +
                '</ol>' +
                '<span itemprop="object">' +
                    '[' +
                        '{' +
                            '"array":[],' +
                            '"bar":"foo",' +
                            '"map":[["key1","value1"],["key2","value2"]],' +
                            '"set":[1,2,3]' +
                        '},' +
                        '[1,2,3],' +
                        '42' +
                    ']' +
                '</span>' +
                '<ol itemprop="map">' +
                    '<li>' +
                        '<dl></dl>' +
                    '</li>' +
                    '<li>' +
                        '<dl>' +
                            '<dt>key1</dt><dd>value1</dd>' +
                            '<dt>key2</dt><dd>value2</dd>' +
                        '</dl>' +
                    '</li>' +
                '</ol>' +
                '<ol itemprop="set">' +
                    '<li>' +
                        '<ul></ul>' +
                    '</li>' +
                    '<li>' +
                        '<ul>' +
                            '<li>1</li>' +
                            '<li>2</li>' +
                            '<li>3</li>' +
                        '</ul>' +
                    '</li>' +
                '</ol>' +
            '</div>'
        );
    });

    it('should convert "object" value type properties with primitive types', () => {
        const values = {
            bool: [true, false],
            str: ['String with spaces', '1STRING', 'Greek word "kosme": "κόσμε"'],
            nr: [Math.PI, 42, 1.32e23, 123.456789]
        } as const;

        const expected = {
            bool: ['true', 'false'],
            str: ['"String with spaces"', '"1STRING"', '"Greek word \\"kosme\\": \\"κόσμε\\""'],
            nr: ['3.141592653589793', '42', '1.32e+23', '123.456789']
        } as const;

        for (const type of Object.keys(values)) {
            values[type as keyof typeof values].forEach((v: any, idx: number) => {
                const obj: OneTest$TypeTest = {
                    $type$: 'OneTest$TypeTest',
                    object: v
                };
                const microdata = convertObjToMicrodata(obj);
                expect(microdata).to.equal(
                    [
                        '<div itemscope itemtype="//refin.io/OneTest$TypeTest">',
                        `<span itemprop="object">${
                            expected[type as keyof typeof expected][idx]
                        }</span>`,
                        '</div>'
                    ].join('')
                );

                // @todo un comment when microdata to object is finished
                // expect(convertMicrodataToObject(microdata)).to.deep.equal(obj);
            });
        }
    });

    /*
    <span itemprop="object">42</span>
    <span itemprop="object">[1,2,3]</span>
    <span itemprop="object">
        {"array":[],"bar":"foo","map":[["key1","value1"],["key2","value2"]],"set":[1,2,3]}
    </span>
     */

    it('should convert "OneTest$TypeTest" (with nested array to json) to microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'OneTest$TypeTest',
            // OBJECT IS A NESTED ARRAY test
            object: [
                [
                    {
                        set: new Set([1, 2, 3]),
                        map: new Map([
                            ['key1', 'value1'],
                            ['key2', 'value2']
                        ]),
                        array: [],
                        bar: 'foo'
                    }
                ]
            ]
        });

        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$TypeTest">' +
                '<span itemprop="object">' +
                '[' +
                    '[' +
                        '{' +
                            '"array":[],' +
                            '"bar":"foo",' +
                            '"map":[["key1","value1"],["key2","value2"]],' +
                            '"set":[1,2,3]' +
                        '}' +
                    ']' +
                ']' +
                '</span>' +
            '</div>'
        );
    });

    it('should convert "OneTest$TypeTest" (with object to json) to microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'OneTest$TypeTest',
            // OBJECT IS AN OBJECT test
            object: {
                set: new Set([1, 2, 3]),
                map: new Map([
                    ['key1', 'value1'],
                    ['key2', 'value2']
                ]),
                array: [],
                bar: 'foo'
            }
        });

        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$TypeTest">' +
                '<span itemprop="object">' +
                    '{' +
                        '"array":[],' +
                        '"bar":"foo",' +
                        '"map":[["key1","value1"],["key2","value2"]],' +
                        '"set":[1,2,3]' +
                    '}' +
                '</span>' +
            '</div>'
        );
    });

    it('should convert "OneTest$Email" ID-object to microdata', () => {
        const microdata = convertObjToIdMicrodata({
            $type$: 'OneTest$Email',
            messageID: 'dummy-123.123@dummy.com'
        });

        expect(microdata).to.equal(
            // prettier-ignore
            '<div data-id-object="true" itemscope itemtype="//refin.io/OneTest$Email">' +
                '<span itemprop="messageID">dummy-123.123@dummy.com</span>' +
            '</div>'
        );
    });

    it('should FAIL to convert "OneTest$Email" object with invalid hash string', () => {
        const badHash = 'XXXX9a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184';

        function createMicrodataFn(referenceHash: SHA256IdHash<Person>): () => string {
            return () =>
                convertObjToMicrodata({
                    $type$: 'OneTest$Email',
                    messageID: 'dummy-123.123@dummy.com',
                    from: [referenceHash]
                });
        }

        expect(createMicrodataFn(badHash as SHA256IdHash<Person>)).to.throw(
            Error,
            'O2M-RTYC4: Value for hash-link itemprop "from" should be SHA-256 hash (lower case ' +
                'hex 64 characters), Value: ' +
                'XXXX9a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184'
        );
    });

    it('should FAIL to convert invalid object with wrong included type to microdata', () => {
        function microdataFn(): string {
            return convertObjToMicrodata({
                $type$: 'OneTest$KeyValueMap',
                name: 'foo bar',
                keyJsType: 'string',
                valueJsType: 'string',
                item: [
                    {
                        // Wrong type: The rule for "OneTest$KeyValueMap" says this must be a nested
                        // object (no "type", just an object that belongs to the KeyValueMap type).
                        $type$: 'Person',
                        email: 'me@there.com'
                    } as any
                ]
            });
        }
        expect(microdataFn).to.throw(Error, 'Mandatory property "key" missing; Rule:');
    });

    it('should FAIL to convert invalid object with unexpected included type to microdata', () => {
        function microdataFn(): string {
            return convertObjToMicrodata({
                $type$: 'OneTest$KeyValueMap',
                // This should be a string, not an included object
                name: {$type$: 'Person', email: 'mh@foo.com'},
                item: []
            } as any);
        }

        expect(microdataFn).to.throw(
            Error,
            'O2M-RTYC1: Value for itemprop "name" should be of type "string", ' +
                'Value: {"$type$":"Person","email":"mh@foo.com"}'
        );
    });

    it('should FAIL to convert imploded object', () => {
        function microdataFn(): string {
            return convertObjToMicrodata({
                $type$: 'Access',
                object: {
                    $type$: 'OneTest$Email',
                    messageID: '3Mai1',
                    subject: 'Betreff',
                    rawEmail: '5232653ef54ef4e32e45232653ef54ef4e32e45232653ef54ef4e32e4523265c'
                },
                person: ['3426326432132432ffed3426326432132432ffed3426326432132432ffed2222'],
                group: []
            } as any);
        }

        expect(microdataFn).to.throw(
            Error,
            'O2M-RTYC4: Value for hash-link itemprop "object" should be SHA-256 hash (lower ' +
                'case hex 64 characters), Value: ' +
                '{"$type$":"OneTest$Email","messageID":"3Mai1","rawEmail":' +
                '"5232653ef54ef4e32e45232653ef54ef4e32e45232653ef54ef4e32e4523265c",' +
                '"subject":"Betreff"}'
        );
    });

    it('should FAIL to convert imploded object with incorrect reference type', () => {
        // eslint-disable-next-line func-style
        const microdataFn = (): string =>
            convertObjToMicrodata({
                // @ts-ignore - The type is intentionally wrong
                $type$: 'Grant',
                accessIsGrantedTo: {
                    $type$: 'OneTest$Email',
                    messageID: '3Mai1',
                    subject: 'Subject',
                    rawEmail: '3426326432132432ffed3426326432132432ffed3426326432132432ffed2222'
                }
            });

        expect(microdataFn).to.throw(Error, 'Type "Grant" not found in recipes');
    });

    it('should FAIL to convert to ID object if the object is not versioned', () => {
        function microdataFn(): string {
            return convertObjToIdMicrodata({
                $type$: 'OneTest$KeyValueMap',
                name: 'Person => OneTest$Email',
                item: [
                    {
                        key: '0006d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        value: [
                            '3336d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                            '3446d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                            '4996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a'
                        ]
                    }
                ]
            });
        }

        expect(microdataFn).to.throw(Error, 'Cannot make ID object from unversioned obj.');
    });

    it('should FAIL to convert object with a missing ID property to microdata', () => {
        function microdataFn(): string {
            return convertObjToMicrodata({
                $type$: 'Person',
                // ID property "email" is missing
                name: 'Some Name'
            } as any);
        }

        expect(microdataFn).to.throw(Error, 'Mandatory property "email" missing');
    });

    it('should FAIL to convert object with properties not mentioned in the recipe', () => {
        function microdataFn(): string {
            return convertObjToMicrodata({
                $type$: 'Person',
                email: 'foo@test.com',
                firstname: 'Some Name',
                surname: 'Some Name',
                foo: 42
            } as any);
        }

        expect(microdataFn).to.throw(
            Error,
            'O2M-COBJ2: Unknown properties ["firstname","foo","surname"] in ' +
                '{' +
                '"$type$":"Person",' +
                '"email":"foo@test.com",' +
                '"firstname":"Some Name",' +
                '"foo":42,' +
                '"surname":"Some Name"' +
                '}'
        );
    });

    it('should convert Instance object', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'Instance',
            name: 'test',
            owner: 'cd6325a308ce2796d01a4f156d002cbb91df1f541c9d6bd57f0523b2e0e9763d' as SHA256IdHash<Person>,
            recipe: new Set(),
            enabledReverseMapTypes: new Map(),
            enabledReverseMapTypesForIdObjects: new Map()
        });
        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/Instance">' +
                '<span itemprop="name">test</span>' +
                '<a itemprop="owner" data-type="id">' +
                    'cd6325a308ce2796d01a4f156d002cbb91df1f541c9d6bd57f0523b2e0e9763d' +
                '</a>' +
                '<ul itemprop="recipe"></ul>' +
                '<dl itemprop="enabledReverseMapTypes"></dl>' +
                '<dl itemprop="enabledReverseMapTypesForIdObjects"></dl>' +
            '</div>'
        );
    });

    it('should FAIL to convert object with an array on a single-value-property to microdata', () => {
        // 1.) ID property
        function createEmailMicrodataFn(): () => string {
            return () =>
                convertObjToMicrodata({
                    $type$: 'OneTest$Email',
                    messageID: ['dummy-123.123@dummy.com'],
                    from: [
                        'd621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965' as SHA256Hash
                    ]
                } as any);
        }

        expect(createEmailMicrodataFn()).to.throw(
            Error,
            'O2M-RTYC1: ' +
                'Value for itemprop "messageID" should be of type "string", ' +
                'Value: ["dummy-123.123@dummy.com"]'
        );

        // 2.) Non-ID property
        function microdataFn(): string {
            // @ts-ignore - Deliberate type mismatch string[] instead of string
            return convertObjToMicrodata({
                $type$: 'OneTest$Email',
                messageID: 'dummy-123.123@dummy.com',
                subject: ['Text']
            });
        }

        expect(microdataFn).to.throw(
            Error,
            'O2M-RTYC1: Value for itemprop "subject" should be of type "string", Value: ["Text"]'
        );
    });

    it('should convert (a recursive) key-value map object to key-value map microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'OneTest$KeyValueMap',
            name: 'Person => OneTest$Email',
            keyJsType: 'string',
            valueJsType: 'string',
            item: [
                {
                    key: '0006d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                    value: [
                        '2996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '3996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '3116d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '3226d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '3336d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '3446d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '4996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a'
                    ]
                },
                {
                    key: '4446d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                    value: [
                        '55996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '6996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '1236d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '7996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a'
                    ]
                },
                {
                    key: '5556d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                    value: [
                        '25996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '2996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                        '2696d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a'
                    ]
                }
            ]
        });

        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$KeyValueMap">' +
                '<span itemprop="name">Person =&gt; OneTest$Email</span>' +
                '<span itemprop="keyJsType">string</span>' +
                '<span itemprop="valueJsType">string</span>' +
                '<ol itemprop="item">' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="key">' +
                                '0006d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a' +
                            '</span>' +
                            '<ol itemprop="value">' +
                                '<li>2996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>3996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>3116d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>3226d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>3336d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>3446d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>4996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                            '</ol>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="key">' +
                                '4446d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a' +
                            '</span>' +
                            '<ol itemprop="value">' +
                                '<li>55996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>6996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>1236d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>7996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                            '</ol>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="key">' +
                                '5556d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a' +
                            '</span>' +
                            '<ol itemprop="value">' +
                                '<li>25996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>2996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                                '<li>2696d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</li>' +
                            '</ol>' +
                        '</div>' +
                    '</li>' +
                '</ol>' +
            '</div>'
        );
    });

    it('should convert Recipe object to microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'Recipe',
            name: 'OneTest$TestUnversioned',
            rule: [
                {
                    itemprop: 'prop1'
                },
                {
                    itemprop: 'prop2',
                    isId: true
                },
                {
                    itemprop: 'prop3',
                    itemtype: {
                        type: 'array',
                        item: {type: 'string'}
                    }
                },
                {
                    itemprop: 'prop4',
                    itemtype: {
                        type: 'map',
                        key: {type: 'string'},
                        value: {type: 'string'}
                    }
                },
                {
                    itemprop: 'prop5',
                    itemtype: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['OneTest$Email', 'OneTest$Mailbox'])
                    }
                },
                {
                    itemprop: 'prop6',
                    // @ts-ignore - Deliberate insertion of non-existent property
                    ref: true
                }
            ]
        });

        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/Recipe">' +
                '<span itemprop="name">OneTest$TestUnversioned</span>' +
                '<ol itemprop="rule">' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="itemprop">prop1</span>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="itemprop">prop2</span>' +
                            '<span itemprop="isId">true</span>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="itemprop">prop3</span>' +
                            '<span itemprop="itemtype">' +
                                '{"item":{"type":"string"},"type":"array"}' +
                            '</span>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="itemprop">prop4</span>' +
                            '<span itemprop="itemtype">' +
                                '{"key":{"type":"string"},"type":"map","value":{"type":"string"}}' +
                            '</span>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="itemprop">prop5</span>' +
                            '<span itemprop="itemtype">' +
                                '{' +
                                    '"allowedTypes":["OneTest$Email","OneTest$Mailbox"],' +
                                    '"type":"referenceToObj"' +
                                '}' +
                            '</span>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                        '<span itemprop="itemprop">prop6</span>' +
                        '</div>' +
                    '</li>' +
                '</ol>' +
            '</div>'
        );
    });

    it('should convert nested key-value map object to key-value map microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'OneTest$KeyValueMap',
            name: 'Test Map',
            item: [
                {
                    key: 'key1',
                    value: ['v1-1', 'v1-2', 'v1-3', 'v1-4', 'v1-5']
                },
                {
                    key: 'key2',
                    value: ['v2-1', 'v2-2', 'v2-3']
                },
                {
                    key: 'key3',
                    value: ['v3-1', 'v3-2']
                }
            ]
        });

        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$KeyValueMap">' +
                '<span itemprop="name">Test Map</span>' +
                '<ol itemprop="item">' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="key">key1</span>' +
                            '<ol itemprop="value">' +
                                '<li>v1-1</li>' +
                                '<li>v1-2</li>' +
                                '<li>v1-3</li>' +
                                '<li>v1-4</li>' +
                                '<li>v1-5</li>' +
                            '</ol>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="key">key2</span>' +
                            '<ol itemprop="value">' +
                                '<li>v2-1</li>' +
                                '<li>v2-2</li>' +
                                '<li>v2-3</li>' +
                            '</ol>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="key">key3</span>' +
                            '<ol itemprop="value">' +
                                '<li>v3-1</li>' +
                                '<li>v3-2</li>' +
                            '</ol>' +
                        '</div>' +
                    '</li>' +
                '</ol>' +
            '</div>'
        );

        const microdata2 = convertObjToMicrodata({
            $type$: 'OneTest$KeyValueMap',
            name: 'Test Map',
            item: []
        });

        expect(microdata2).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$KeyValueMap">' +
                '<span itemprop="name">Test Map</span>' +
                '<ol itemprop="item"></ol>' +
            '</div>'
        );
    });

    it('should convert object with RegExp-checked string value', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'OneTest$TypeTest',
            string: ['winfried', '', 'WINFRied']
        });

        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$TypeTest">' +
                '<ol itemprop="string">' +
                    '<li>winfried</li>' +
                    '<li></li>' +
                    '<li>WINFRied</li>' +
                '</ol>' +
            '</div>'
        );
    });

    it('should FAIL to convert object with irregular RegExp-checked string value', () => {
        const improperValue = '1$äöü&%§$&%%-&';

        function microdataFn(): string {
            return convertObjToMicrodata({
                $type$: 'OneTest$TypeTest',
                string: ['winfried', improperValue]
            });
        }

        expect(microdataFn).to.throw(
            Error,
            `Property "string" value "${improperValue}" does not match RegExp "^[\\\\w\\"'\\\\s]*$"`
        );
    });

    it('should convert OneTest$Inherit1Recipe object to microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'OneTest$Inherit1Recipe',
            namedRuleProp1: {
                namedRuleItem1: 'ruleItemValue1'
            },
            inheritRuleProp1: {
                override1: {
                    namedRuleItem1: 'value1'
                }
            },
            inheritRuleProp2: {
                override2: {
                    namedRuleItem2: 'value2'
                }
            }
        });

        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$Inherit1Recipe">' +
                '<div itemprop="namedRuleProp1">' +
                    '<span itemprop="namedRuleItem1">ruleItemValue1</span>' +
                '</div>' +
                '<div itemprop="inheritRuleProp1">' +
                    '<div itemprop="override1">' +
                        '<span itemprop="namedRuleItem1">value1</span>' +
                    '</div>' +
                '</div>' +
                '<div itemprop="inheritRuleProp2">' +
                    '<div itemprop="override2">' +
                        '<span itemprop="namedRuleItem2">value2</span>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    });

    it('should convert OneTest$Inherit2Recipe object to microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'OneTest$Inherit2Recipe',
            namedRuleProp2: {
                namedRuleItem2: 'ruleItemValue2'
            },
            inheritRuleProp1: {
                override1: {
                    namedRuleItem1: 'value1'
                }
            },
            inheritRuleProp2: {
                override2: {
                    namedRuleItem2: 'value2'
                }
            }
        });
        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$Inherit2Recipe">' +
                '<div itemprop="namedRuleProp2">' +
                    '<span itemprop="namedRuleItem2">ruleItemValue2</span>' +
                '</div>' +
                '<div itemprop="inheritRuleProp1">' +
                    '<div itemprop="override1">' +
                        '<span itemprop="namedRuleItem1">value1</span>' +
                    '</div>' +
                '</div>' +
                '<div itemprop="inheritRuleProp2">' +
                    '<div itemprop="override2">' +
                        '<span itemprop="namedRuleItem2">value2</span>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    });

    it('should convert empty mandatory collection properties to microdata', () => {
        const microdata = convertObjToMicrodata({
            $type$: 'OneTest$MandatoryCollectionsTest',
            array: [],
            bag: [],
            map: new Map(),
            set: new Set(),
            stringifiable: ''
        });
        expect(microdata).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$MandatoryCollectionsTest">' +
                '<ol itemprop="array"></ol>' +
                '<ul itemprop="bag"></ul>' +
                '<dl itemprop="map"></dl>' +
                '<ul itemprop="set"></ul>' +
                '<span itemprop="stringifiable">""</span>' +
            '</div>'
        );
    });

    it('should convert missing optional collection properties to microdata', () => {
        expect(
            convertObjToMicrodata({
                $type$: 'OneTest$OptionalCollectionsTest',
                array: [],
                bag: [],
                map: new Map(),
                set: new Set(),
                stringifiable: ''
            })
        ).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                '<ol itemprop="array"></ol>' +
                '<ul itemprop="bag"></ul>' +
                '<dl itemprop="map"></dl>' +
                '<ul itemprop="set"></ul>' +
                '<span itemprop="stringifiable">""</span>' +
            '</div>'
        );

        expect(
            convertObjToMicrodata({
                $type$: 'OneTest$OptionalCollectionsTest',
                array: []
            })
        ).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                '<ol itemprop="array"></ol>' +
            '</div>'
        );

        expect(
            convertObjToMicrodata({
                $type$: 'OneTest$OptionalCollectionsTest',
                bag: []
            })
        ).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                '<ul itemprop="bag"></ul>' +
            '</div>'
        );

        expect(
            convertObjToMicrodata({
                $type$: 'OneTest$OptionalCollectionsTest',
                map: new Map()
            })
        ).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                '<dl itemprop="map"></dl>' +
            '</div>'
        );

        expect(
            convertObjToMicrodata({
                $type$: 'OneTest$OptionalCollectionsTest',
                set: new Set()
            })
        ).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                '<ul itemprop="set"></ul>' +
            '</div>'
        );

        expect(
            convertObjToMicrodata({
                $type$: 'OneTest$OptionalCollectionsTest',
                stringifiable: ''
            })
        ).to.equal(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                '<span itemprop="stringifiable">""</span>' +
            '</div>'
        );

        expect(
            convertObjToMicrodata({
                $type$: 'OneTest$OptionalCollectionsTest'
            })
        ).to.equal('<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest"></div>');
    });
});
