import {expect} from 'chai';

import {convertIdMicrodataToObject, convertMicrodataToObject} from '../../lib/microdata-to-object.js';
import {addCoreRecipesToRuntime, clearRuntimeRecipes} from '../../lib/object-recipes.js';
import type {OneObjectTypes} from '../../lib/recipes.js';
import {SYSTEM} from '../../lib/system/platform.js';
import {calculateIdHashOfObj, ID_OBJECT_ATTR} from '../../lib/util/object.js';

import {addTestTypes} from './_register-types.js';

describe('Microdata to Object conversion tests', () => {
    before(async () => {
        await import(`../../lib/system/load-${SYSTEM}.js`);
        addCoreRecipesToRuntime();
        addTestTypes();
    });
    after(clearRuntimeRecipes);

    it('should convert microdata of type "OneTest$Email" to a JS object', () => {
        const obj = convertMicrodataToObject(
            // prettier-ignore
            [
                '<div itemscope itemtype="//refin.io/OneTest$Email">',
                    '<span itemprop="messageID">dummy-123.123@dummy.com</span>',
                    '<ul itemprop="from">',
                        '<li>',
                            '<a data-type="id">cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
                        '</li>',
                    '</ul>',
                    '<ul itemprop="to">',
                        '<li>',
                            '<a data-type="id">1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
                        '</li>',
                        '<li>',
                            '<a data-type="id">aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208</a>',
                        '</li>',
                    '</ul>',
                    '<span itemprop="date">1438418318000</span>',
                    '<span itemprop="subject">Zwei Anhänge</span>',
                    '<a itemprop="html" data-type="clob">7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4</a>',
                    '<a itemprop="text" data-type="blob">0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</a>',
                    '<ul itemprop="attachment">',
                        '<li>',
                            '<a data-type="blob">7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71</a>',
                        '</li>',
                        '<li>',
                            '<a data-type="blob">d621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965</a>',
                        '</li>',
                    '</ul>',
                    '<a itemprop="rawEmail" data-type="blob">59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95</a>',
                '</div>'
            ].join('')
        );
        expect(obj).to.deep.equal({
            $type$: 'OneTest$Email',
            messageID: 'dummy-123.123@dummy.com',
            from: ['cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184'],
            to: [
                '1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184',
                'aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208'
            ],
            subject: 'Zwei Anhänge',
            date: 1438418318000,
            rawEmail: '59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95',
            html: '7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4',
            text: '0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
            attachment: [
                '7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71',
                'd621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965'
            ]
        });
    });

    it('should convert microdata of type "Person" to a JS object', () => {
        const obj = convertMicrodataToObject(
            '<div itemscope itemtype="//refin.io/Person">' +
                '<span itemprop="email">winfried@mail.com</span>' +
                '</div>'
        );

        expect(obj).to.deep.equal({
            $type$: 'Person',
            email: 'winfried@mail.com'
        });
    });

    it('should convert microdata of type "OneTest$TestVersioned" to a JS object', () => {
        // Tests an id property that *is* missing (recipe says it's optional)
        const obj1 = convertMicrodataToObject(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$TestVersioned">' +
            '<ul itemprop="id"><li>"id item 1"</li><li>"id item 2"</li><li>"id item 3"</li></ul>' +
            '<ul itemprop="data"><li>"item 1"</li><li>"item 2"</li><li>"item 3"</li></ul>' +
            '</div>'
        );
        expect(obj1).to.deep.equal({
            $type$: 'OneTest$TestVersioned',
            id: ['id item 1', 'id item 2', 'id item 3'],
            data: ['item 1', 'item 2', 'item 3']
        });

        // Tests an id property that *is* missing (recipe says it's optional)
        const obj2 = convertMicrodataToObject(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$TestVersioned">' +
            '<ul itemprop="data"><li>"item 1"</li><li>"item 2"</li><li>"item 3"</li></ul>' +
            '</div>'
        );
        expect(obj2).to.deep.equal({
            $type$: 'OneTest$TestVersioned',
            data: ['item 1', 'item 2', 'item 3']
        });
    });

    // TODO The microdata used does not represent current exploded microdata format
    it('should FAIL to convert imploded microdata', () => {
        // prettier-ignore
        const microdata = [
            '<div itemscope itemtype="//refin.io/Access">',
                '<div itemprop="object" itemscope itemtype="//refin.io/OneTest$Email">',
                    '<span itemprop="messageID">3Mai1</span>',
                    '<span itemprop="subject">Betreff</span>',
                '</div>',
            '</div>'
        ].join('');

        function fn(): OneObjectTypes {
            return convertMicrodataToObject(microdata);
        }

        expect(fn).to.throw(
            Error,
            'M2O-PD1: Value for property "object" is missing but there is no "optional" flag'
        );
    });

    it('should convert microdata with reference type', () => {
        const obj = convertMicrodataToObject(
            // prettier-ignore
            [
                '<div itemscope itemtype="//refin.io/Access">',
                    '<a itemprop="object" data-type="obj">cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
                    '<ul itemprop="person">',
                        '<li>',
                            '<a data-type="id">111119bfc4a8bdb1f6b7e344b3ba3acbb9e18882ee08096a41ebe9c7356f121e</a>',
                        '</li>',
                    '</ul>',
                    '<ul itemprop="group"></ul>',
                '</div>'
            ].join('')
        );

        expect(obj).to.deep.equal({
            $type$: 'Access',
            object: 'cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184',
            person: ['111119bfc4a8bdb1f6b7e344b3ba3acbb9e18882ee08096a41ebe9c7356f121e'],
            group: []
        });
    });

    it('should convert microdata with empty array field to an empty array', () => {
        const obj = convertMicrodataToObject(
            // prettier-ignore
            [
                '<div itemscope itemtype="//refin.io/Access">',
                    '<a itemprop="object" data-type="obj">cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
                    // EMPTY array properties: person, group
                    '<ul itemprop="person"></ul>',
                    '<ul itemprop="group"></ul>',
                '</div>'
            ].join('')
        );

        expect(obj).to.deep.equal({
            $type$: 'Access',
            object: 'cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184',
            person: [],
            group: []
        });
    });

    // TODO The microdata used does not represent current exploded microdata format
    it('should FAIL to convert imploded microdata with incorrect reference type', () => {
        // prettier-ignore
        const microdata = [
            '<div itemscope itemtype="//refin.io/Access">',
                '<span itemprop="object" itemscope itemtype="//refin.io/OneTest$Email">',
                    '<a itemprop="id" data-type="id">' +
                        '3116d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a' +
                    '</a>',
                '</span>',
            '</div>'
        ].join('');

        function objFn(): OneObjectTypes {
            return convertMicrodataToObject(microdata);
        }

        expect(objFn).to.throw(
            Error,
            'M2O-PD1: Value for property "object" is missing but there is no "optional" flag;'
        );
    });

    it('should FAIL to convert microdata of type "UNKNOWN" to a JS object', () => {
        function objFn(): OneObjectTypes {
            return convertMicrodataToObject(
                // prettier-ignore
                [
                    '<div itemscope itemtype="//refin.io/UNKNOWN">',
                        '<span itemprop="email">winfried@mail.com</span>',
                    '</div>'
                ].join('')
            );
        }

        expect(objFn).to.throw(Error, 'Type "UNKNOWN" not found in recipes');
    });

    it('should FAIL to convert microdata with invalid JSON to a JS object', () => {
        function objFn(): OneObjectTypes {
            return convertMicrodataToObject(
                // prettier-ignore
                [
                    '<div itemscope itemtype="//refin.io/OneTest$ImapAccount">',
                        '<span itemprop="email">winfried@mail.com</span>',
                        '<span itemprop="host">www.mail.com</span>',
                        '<span itemprop="user">mail</span>',
                        '<span itemprop="password">password</span>',
                        '<span itemprop="port">42</span>',
                        '<span itemprop="tlsOptions">{not a valid json string}</span>',
                    '</div>'
                ].join('')
            );
        }

        expect(objFn).to.throw(SyntaxError);
    });

    it('should FAIL to convert broken HTML in a microdata "OneTest$Email" object to a JS object', () => {
        function objFn(): OneObjectTypes {
            return convertMicrodataToObject(
                // prettier-ignore
                [
                    '<div itemscope itemtype="//refin.io/OneTest$Email"', // MISSING FINAL ">"
                        '<span itemprop="messageID">dummy-123.123@dummy.com</span>',
                        '<ul itemprop="from">',
                            '<li>',
                                '<a data-type="id">cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
                            '</li>',
                        '</ul>',
                        '<ul itemprop="to">',
                            '<li>',
                                '<a data-type="id">1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
                            '</li>',
                            '<li>',
                                '<a data-type="id">aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208</a>',
                            '</li>',
                        '</ul>',
                        '<span itemprop="date">1438418318001</span>',
                        '<span itemprop="subject">Zwei Anhänge</span>',
                        '<a itemprop="html" data-type="clob">7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4</a>',
                        '<a itemprop="text" data-type="blob">0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</a>',
                        '<ul itemprop="attachment">',
                            '<li>',
                                '<a data-type="blob">7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71</a>',
                            '</li>',
                            '<li>',
                                '<a data-type="blob">d621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965</a>',
                            '</li>',
                        '</ul>',
                        '<a itemprop="rawEmail" data-type="blob">59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95</a>',
                    '</div>'
                ].join('')
            );
        }

        expect(objFn).to.throw(
            Error,
            'Type "OneTest$Email"<span itemprop="messageID" not found in recipes'
        );
    });

    it('should FAIL to convert an "OneTest$Email" object with an unknown tag to a JS object', () => {
        function objFn(): OneObjectTypes {
            return convertMicrodataToObject(
                // prettier-ignore
                [
                    '<div itemscope itemtype="//refin.io/OneTest$Email">',
                        '<span itemprop="messageID">dummy-123.123@dummy.com</span>',
                        '<span itemprop="fake">UNKNOWN TAG</span>',
                        '<ul itemprop="from">',
                            '<li>',
                                '<a data-type="id">cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
                            '</li>',
                        '</ul>',
                        '<ul itemprop="to">',
                            '<li>',
                                '<a data-type="id">1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
                            '</li>',
                            '<li>',
                                '<a data-type="id">aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208</a>',
                            '</li>',
                        '</ul>',
                        '<span itemprop="date">1438418318001</span>',
                        '<span itemprop="subject">Zwei Anhänge</span>',
                        '<a itemprop="html" data-type="clob">7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4</a>',
                        '<a itemprop="text" data-type="blob">0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</a>',
                        '<ul itemprop="attachment">',
                            '<li>',
                                '<a data-type="blob">7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71</a>',
                            '</li>',
                            '<li>',
                                '<a data-type="blob">d621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965</a>',
                            '</li>',
                        '</ul>',
                        '<a itemprop="rawEmail" data-type="blob">59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95</a>',
                    '</div>'
                ].join('')
            );
        }

        // if html field was not present in the object, the error would be 'Expected end-tag
        // </div> because of the unknown tag
        expect(objFn).to.throw(
            Error,
            'M2O-POM1: Expected end-tag </div> not found (position: 108), Microdata:'
        );
    });

    it('should convert microdata with similar property names into JS object', async () => {
        const host = 'imap.gmail.com';
        const user = 'foo.bar@gmail.com';

        const imapAcctIdHash = await calculateIdHashOfObj({
            $type$: 'OneTest$ImapAccount',
            host,
            user
        });

        const inboxIdHash = await calculateIdHashOfObj({
            $type$: 'OneTest$Mailbox',
            account: imapAcctIdHash,
            name: 'INBOX'
        });

        const sentIdHash = await calculateIdHashOfObj({
            $type$: 'OneTest$Mailbox',
            account: imapAcctIdHash,
            name: 'Sent'
        });

        const obj = convertMicrodataToObject(
            // prettier-ignore
            [
                '<div itemscope itemtype="//refin.io/OneTest$ImapAccount">',
                    '<span itemprop="email">tester@demo.org</span>',
                    `<span itemprop="host">${host}</span>`,
                    `<span itemprop="user">${user}</span>`,
                    '<span itemprop="password">topsekret</span>',
                    '<span itemprop="port">993</span>',
                    '<span itemprop="tls">true</span>',
                    '<span itemprop="tlsOptions">{"rejectUnauthorized":false}</span>',
                    '<span itemprop="delimiter">/</span>',
                    '<ul itemprop="mailbox">',
                        `<li><a data-type="id">${inboxIdHash}</a></li>`,
                        `<li><a data-type="id">${sentIdHash}</a></li>`,
                    '</ul>',
                '</div>'
            ].join('')
        );

        expect(obj).to.deep.equal({
            $type$: 'OneTest$ImapAccount',
            email: 'tester@demo.org',
            host: 'imap.gmail.com',
            user: 'foo.bar@gmail.com',
            password: 'topsekret',
            port: 993,
            tls: true,
            tlsOptions: {rejectUnauthorized: false},
            delimiter: '/',
            mailbox: [inboxIdHash, sentIdHash]
        });
    });

    it('should convert "OneTest$TypeTest" microdata to object', () => {
        const obj = convertMicrodataToObject(
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
                '<span itemprop="object">[{"array":[],"bar":"foo","map":[["key1","value1"],["key2","value2"]],"set":[1,2,3]},[1,2,3],42]</span>' +
                '<ol itemprop="map">' +
                    '<li>' +
                        '<dl></dl>' +
                    '</li>' +
                    '<li>' +
                        '<dl>' +
                            '<dt>key1</dt>' +
                            '<dd>value1</dd>' +
                            '<dt>key2</dt>' +
                            '<dd>value2</dd>' +
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
            '</div>',
            'OneTest$TypeTest'
        );

        if (!obj.map || !obj.set) {
            throw new Error('no Map, no Set');
        }

        expect(obj.map[0] instanceof Map).to.be.true;
        expect(obj.map[1] instanceof Map).to.be.true;
        expect(obj.set[0] instanceof Set).to.be.true;
        expect(obj.set[1] instanceof Set).to.be.true;

        expect(obj).to.deep.equal({
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
            // Always stored as single value even if list was set (which checks forbid)
            object: [
                {
                    array: [],
                    bar: 'foo',
                    map: [
                        ['key1', 'value1'],
                        ['key2', 'value2']
                    ],
                    set: [1, 2, 3]
                },
                [1, 2, 3],
                42
            ]
        });
    });

    it('should convert "object" value type properties with primitive types', () => {
        const values = {
            bool: ['true', 'false'],
            str: ['"String with spaces"', '"1STRING"', '"Greek word \\"kosme\\": \\"κόσμε\\""'],
            nr: ['3.141592653589793', '42', '1.32e+23', '123.456789']
        } as const;

        const expected = {
            bool: [true, false],
            str: ['String with spaces', '1STRING', 'Greek word "kosme": "κόσμε"'],
            nr: [Math.PI, 42, 1.32e23, 123.456789]
        } as const;

        for (const type of Object.keys(values)) {
            values[type as keyof typeof values].forEach((v: any, idx: number) => {
                const microdata = [
                    '<div itemscope itemtype="//refin.io/OneTest$TypeTest">',
                    `<span itemprop="object">${v}</span>`,
                    '</div>'
                ].join('');

                expect(convertMicrodataToObject(microdata)).to.deep.equal({
                    $type$: 'OneTest$TypeTest',
                    object: expected[type as keyof typeof expected][idx]
                });
            });
        }
    });

    it('should convert recursive microdata to a JS object', () => {
        const obj = convertMicrodataToObject(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$KeyValueMap">' +
                '<span itemprop="name">Person =&gt; OneTest$Email</span>' +
                '<span itemprop="keyJsType">string</span>' +
                '<span itemprop="valueJsType">string</span>' +
                '<ol itemprop="item">' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="key">0006d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</span>' +
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
                            '<span itemprop="key">4446d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</span>' +
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
                            '<span itemprop="key">5556d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</span>' +
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

        expect(obj).to.deep.equal({
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
    });

    // @todo make the parser check required values
    it('should FAIL to convert recursive microdata if the subobject has the properties', () => {
        function objFn(): OneObjectTypes {
            return convertMicrodataToObject(
                // prettier-ignore
                [
                    '<div itemscope itemtype="//refin.io/OneTest$KeyValueMap">',
                        '<span itemprop="name">Person =&gt; OneTest$Email</span>',
                        '<span itemprop="keyJsType">string</span>',
                        '<span itemprop="valueJsType">string</span>',
                        '<ol itemprop="item">',
                            '<li>',
                                '<div>',
                                    '<ol itemprop="value">',
                                        '<li>s</li>',
                                    '</ol>',
                                '</div>',
                            '</li>',
                        '</ol>',
                    '</div>'
                ].join('')
            );
        }

        expect(objFn).to.throw(
            Error,
            'M2O-EOTFM1: Value for property "key" is missing but there is no "optional" flag'
        );
    });

    it('should FAIL to convert microdata if the object has the wrong type', () => {
        function objFn(): OneObjectTypes {
            return convertMicrodataToObject(
                // prettier-ignore
                [
                    '<div itemscope itemtype="//refin.io/Person">',
                        '<span itemprop="email">winfried@mail.com</span>',
                    '</div>'
                ].join(''),
                // We expect an Access-object
                'Access'
            );
        }

        expect(objFn).to.throw(Error, 'M2O-PHM1: Expected type ["Access"], got Person');
    });

    it('should FAIL to convert microdata with an invalid hash string in a link property', () => {
        function objFn(): OneObjectTypes {
            return convertMicrodataToObject(
                // prettier-ignore
                [
                    '<div itemscope itemtype="//refin.io/OneTest$ImapAccount">',
                        '<span itemprop="email">foo@bar.com</span>',
                        '<span itemprop="host">foo.bar.com</span>',
                        '<span itemprop="user">foobar</span>',
                        '<span itemprop="password">topsekret</span>',
                        '<span itemprop="port">993</span>',
                        '<span itemprop="tls">true</span>',
                        '<span itemprop="tlsOptions">{"rejectUnauthorized":false}</span>',
                        '<span itemprop="delimiter">/</span>',
                        '<ul itemprop="mailbox">',
                            '<li><a data-type="id">NOT A HASH</a></li>',
                        '</ul>',
                    '</div>'
                ].join('')
            );
        }

        expect(objFn).to.throw(
            Error,
            'M2O-PV1: Property "mailbox" is not a valid hash: "NOT A HASH'
        );
    });

    it('should convert microdata all three hash ONE object link types', () => {
        const obj = convertMicrodataToObject(
            // prettier-ignore
            [
                '<div itemscope itemtype="//refin.io/OneTest$ReferenceTest">',
                    '<ul itemprop="versionedRef">',
                        '<li>',
                            '<a data-type="obj">96b88fae53f592899aa81b1f406ef05cd20630e6119b2589a034996562e63544</a>',
                        '</li>',
                    '</ul>',
                    '<ul itemprop="unversionedRef">',
                        '<li>',
                            '<a data-type="obj">5662e0e416171d7702f8e1832c2376393f45e8ab0af4024c7fbeaf01658da35e</a>',
                        '</li>',
                    '</ul>',
                    '<ul itemprop="idRef">',
                        '<li>',
                            '<a data-type="id">7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3</a>',
                        '</li>',
                    '</ul>',
                '</div>'
            ].join('')
        );

        expect(obj).to.deep.equal({
            $type$: 'OneTest$ReferenceTest',
            idRef: ['7097aa8204cd91f066331795ec33fc0d837ab72ff75e5f9b949927f12e34b1e3'],
            unversionedRef: ['5662e0e416171d7702f8e1832c2376393f45e8ab0af4024c7fbeaf01658da35e'],
            versionedRef: ['96b88fae53f592899aa81b1f406ef05cd20630e6119b2589a034996562e63544']
        });
    });

    it('should convert Recipe object to microdata', () => {
        const obj = convertMicrodataToObject(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/Recipe">' +
                '<span itemprop="name">DEMO</span>' +
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
                            '<span itemprop="itemtype">{"item":{"type":"string"},"type":"array"}</span>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="itemprop">prop4</span>' +
                            '<span itemprop="itemtype">{"key":{"type":"string"},"type":"map","value":{"type":"string"}}</span>' +
                        '</div>' +
                    '</li>' +
                    '<li>' +
                        '<div>' +
                            '<span itemprop="itemprop">prop5</span>' +
                            '<span itemprop="itemtype">{"referenceToObj":["OneTest$Email","OneTest$Mailbox"],"type":"referenceToObj"}</span>' +
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

        expect(obj).to.deep.equal({
            $type$: 'Recipe',
            name: 'DEMO',
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
                    itemtype: {type: 'array', item: {type: 'string'}}
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
                        referenceToObj: ['OneTest$Email', 'OneTest$Mailbox']
                    }
                },
                {
                    itemprop: 'prop6'
                }
            ]
        });
    });

    it('should convert nested key-value map microdata to key-value map object', () => {
        const obj = convertMicrodataToObject(
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

        expect(obj).to.deep.equal({
            $type$: 'OneTest$KeyValueMap',
            name: 'Test Map',
            item: [
                {
                    key: 'key1',
                    // eslint-disable-next-line quotes
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

        const obj2 = convertMicrodataToObject(
            // prettier-ignore
            [
                '<div itemscope itemtype="//refin.io/OneTest$KeyValueMap">',
                    '<span itemprop="name">Test Map</span>',
                    '<ol itemprop="item"></ol>',
                '</div>'
            ].join('')
        );

        expect(obj2).to.deep.equal({
            $type$: 'OneTest$KeyValueMap',
            name: 'Test Map',
            item: []
        });
    });

    it('should convert object with RegExp-checked string value', () => {
        const microdata = convertMicrodataToObject(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$TypeTest">' +
                '<ol itemprop="string">' +
                    '<li>winfried</li>' +
                    '<li></li>' +
                    '<li>WINFRied</li>' +
                '</ol>' +
            '</div>'
        );

        expect(microdata).to.deep.equal({
            $type$: 'OneTest$TypeTest',
            string: ['winfried', '', 'WINFRied']
        });
    });

    it('should FAIL to convert object with irregular RegExp-checked string value', () => {
        const improperValue = '1$äöü&%§$&%%&';

        function convertFn(): OneObjectTypes {
            return convertMicrodataToObject(
                // prettier-ignore
                '<div itemscope itemtype="//refin.io/OneTest$TypeTest">' +
                    '<ol itemprop="string">' +
                        '<li>winfried</li>' +
                        `<li>${improperValue}</li>` +
                        '<li>WINFRied</li>' +
                    '</ol>' +
                '</div>'
            );
        }

        expect(convertFn).to.throw(
            Error,
            'M2O-PV3: Value "1$äöü&%§$&%%&" does not match RegExp "^[\\\\w\\"\'\\\\s]*$"'
        );
    });

    it('should convert microdata of type "OneTest$Inherit1Recipe" to a JS object', () => {
        const obj = convertMicrodataToObject(
            // prettier-ignore
            [
                '<div itemscope itemtype="//refin.io/OneTest$Inherit1Recipe">' +
                    // Nested objects
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
            ].join('')
        );

        expect(obj).to.deep.equal({
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
    });

    it('should convert microdata of type "OneTest$Inherit2Recipe" to a JS object', () => {
        const obj = convertMicrodataToObject(
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
        expect(obj).to.deep.equal({
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
    });

    it('should FAIL to convert microdata of type "OneTest$Inherit1Recipe"', () => {
        expect(() =>
            convertMicrodataToObject(
                // prettier-ignore
                '<div itemscope itemtype="//refin.io/OneTest$Inherit1Recipe">' +
                    // '<div itemprop="namedRuleProp1">' +
                    //     '<span itemprop="namedRuleItem1">ruleItemValue1</span>' +
                    // '</div>' +
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
            )
        ).to.throw(
            Error,
            'M2O-PD1: Value for property "namedRuleProp1" is missing but there is no "optional" flag'
        );

        expect(() =>
            convertMicrodataToObject(
                // prettier-ignore
                '<div itemscope itemtype="//refin.io/OneTest$Inherit1Recipe">' +
                    '<div itemprop="namedRuleProp1">' +
                        // '<span itemprop="namedRuleItem1">ruleItemValue1</span>' +
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
            )
        ).to.throw(
            Error,
            'M2O-EOTFM1: Value for property "namedRuleItem1" is missing but there is no "optional" flag'
        );

        expect(() =>
            convertMicrodataToObject(
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
                            // '<span itemprop="namedRuleItem2">value2</span>' +
                        '</div>' +
                    '</div>' +
                '</div>'
            )
        ).to.throw(
            Error,
            'M2O-EOTFM1: Value for property "namedRuleItem2" is missing but there is no "optional" flag'
        );
    });

    it('should convert ID microdata of type "Person" to a JS object', () => {
        const obj = convertIdMicrodataToObject(
            // prettier-ignore
            [
                `<div ${ID_OBJECT_ATTR} itemscope itemtype="//refin.io/Person">`,
                    '<span itemprop="email">winfried@mail.com</span>',
                '</div>'
            ].join('')
        );

        expect(obj).to.deep.equal({
            $type$: 'Person',
            email: 'winfried@mail.com'
        });
    });

    it('should convert empty mandatory collection properties to their type', () => {
        const obj = convertMicrodataToObject(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$MandatoryCollectionsTest">' +
                '<ol itemprop="array"></ol>' +
                '<ul itemprop="bag"></ul>' +
                '<dl itemprop="map"></dl>' +
                '<ul itemprop="set"></ul>' +
                '<span itemprop="stringifiable">""</span>' +
            '</div>'
        );

        expect(obj).to.deep.equal({
            $type$: 'OneTest$MandatoryCollectionsTest',
            array: [],
            bag: [],
            map: new Map(),
            set: new Set(),
            stringifiable: ''
        });
    });

    it('should convert empty optional collection properties to their type', () => {
        expect(
            convertMicrodataToObject(
                // prettier-ignore
                '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                    '<ol itemprop="array"></ol>' +
                    '<ul itemprop="bag"></ul>' +
                    '<dl itemprop="map"></dl>' +
                    '<ul itemprop="set"></ul>' +
                    '<span itemprop="stringifiable">""</span>' +
                '</div>'
            )
        ).to.deep.equal({
            $type$: 'OneTest$OptionalCollectionsTest',
            array: [],
            bag: [],
            map: new Map(),
            set: new Set(),
            stringifiable: ''
        });

        expect(
            convertMicrodataToObject(
                // prettier-ignore
                '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                    '<ol itemprop="array"></ol>' +
                '</div>'
            )
        ).to.deep.equal({
            $type$: 'OneTest$OptionalCollectionsTest',
            array: []
        });

        expect(
            convertMicrodataToObject(
                // prettier-ignore
                '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                    '<ul itemprop="bag"></ul>' +
                '</div>'
            )
        ).to.deep.equal({
            $type$: 'OneTest$OptionalCollectionsTest',
            bag: []
        });

        expect(
            convertMicrodataToObject(
                // prettier-ignore
                '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                    '<dl itemprop="map"></dl>' +
                '</div>'
            )
        ).to.deep.equal({
            $type$: 'OneTest$OptionalCollectionsTest',
            map: new Map()
        });

        expect(
            convertMicrodataToObject(
                // prettier-ignore
                '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                    '<ul itemprop="set"></ul>' +
                '</div>'
            )
        ).to.deep.equal({
            $type$: 'OneTest$OptionalCollectionsTest',
            set: new Set()
        });

        expect(
            convertMicrodataToObject(
                // prettier-ignore
                '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest">' +
                    '<span itemprop="stringifiable">""</span>' +
                '</div>'
            )
        ).to.deep.equal({
            $type$: 'OneTest$OptionalCollectionsTest',
            stringifiable: ''
        });

        expect(
            convertMicrodataToObject(
                '<div itemscope itemtype="//refin.io/OneTest$OptionalCollectionsTest"></div>'
            )
        ).to.deep.equal({
            $type$: 'OneTest$OptionalCollectionsTest'
        });
    });
});
