/* eslint-disable no-console */
import {expect} from 'chai';

import * as MicrodataToJSON from '../../lib/microdata-to-json.js';
import {convertMicrodataToJSON} from '../../lib/microdata-to-json.js';
import {convertMicrodataToObject} from '../../lib/microdata-to-object.js';
import {addCoreRecipesToRuntime, clearRuntimeRecipes} from '../../lib/object-recipes.js';
import {convertObjToIdMicrodata} from '../../lib/object-to-microdata.js';
import {SYSTEM} from '../../lib/system/platform.js';
import * as ObjectUtils from '../../lib/util/object.js';
import {ID_OBJ_MICRODATA_START} from '../../lib/util/object.js';
import {stringify} from '../../lib/util/sorted-stringify.js';
import {isIdObjMicrodata} from '../../lib/util/object.js';

import * as TestTypes from './_register-types.js';

describe('Microdata to JSON conversion tests', () => {
    before(async () => {
        await import(`../../lib/system/load-${SYSTEM}.js`);
        addCoreRecipesToRuntime();
        TestTypes.addTestTypes();
    });
    after(clearRuntimeRecipes);

    // prettier-ignore
    const microdata = [
        '<div itemscope itemtype="//refin.io/OneTest$Email">',
            '<span itemprop="messageID">dummy-123.123@dummy.com</span>',
            '<ul itemprop="from">',
                '<li>',
                    '<a data-type="id">' +
                        'cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184' +
                    '</a>',
                '</li>',
            '</ul>',
            '<ul itemprop="to">',
                '<li>',
                    '<a data-type="id">' +
                        '1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184' +
                    '</a>',
                '</li>',
                '<li>',
                    '<a data-type="id">' +
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
                '<li>',
                    '<a data-type="blob">' +
                        '7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71' +
                    '</a>',
                '</li>',
                '<li>',
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

    it('should convert microdata of type "OneTest$Email" to a JS object', () => {
        const json = convertMicrodataToJSON(microdata);

        expect(json).to.equal(
            stringify({
                $type$: 'OneTest$Email',
                messageID: 'dummy-123.123@dummy.com',
                from: ['cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184'],
                to: [
                    '1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184',
                    'aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208'
                ],
                date: 1438418318000,
                subject: 'Zwei Anhänge',
                html: '7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4',
                text: '0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a',
                attachment: [
                    '7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71',
                    'd621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965'
                ],
                rawEmail: '59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95'
            })
        );
    });

    it('should convert microdata of type "OneTest$Email" to a JS object', () => {
        const obj = convertMicrodataToObject(microdata);
        const idMicrodata = convertObjToIdMicrodata(obj);

        expect(idMicrodata).to.contain(ID_OBJ_MICRODATA_START);
        expect(
            isIdObjMicrodata(idMicrodata),
            'isIdObjMicrodata() does not recognize that this is ID-microdata'
        ).to.be.true;

        const json2 = convertMicrodataToJSON(idMicrodata);

        expect(json2).to.equal(
            stringify({
                $type$: 'OneTest$Email',
                messageID: 'dummy-123.123@dummy.com'
            })
        );
    });

    it('should convert microdata of type "Person" to a JS object', () => {
        const json = MicrodataToJSON.convertMicrodataToJSON(
            // prettier-ignore
            [
                '<div itemscope itemtype="//refin.io/Person">',
                    '<span itemprop="email">winfried@mail.com</span>',
                '</div>'
            ].join('')
        );

        expect(json).to.equal('{"$type$":"Person","email":"winfried@mail.com"}');
    });

    // TODO The microdata used does not represent current exploded microdata format
    // it('should FAIL to convert imploded microdata', () => {
    //     function jsonFn(): string {
    //         return MicrodataToJSON.convertMicrodataToJSON(
    //             // prettier-ignore
    //             '<div itemscope itemtype="//refin.io/Access">' +
    //                 '<div itemprop="object" itemscope itemtype="//refin.io/Person">' +
    //                     '<span itemprop="email">michael@onehq.net</span>' +
    //                 '</div>' +
    //             '</div>'
    //         );
    //     }
    //
    //     expect(jsonFn).to.throw(
    //         Error,
    //         'M2O-PD1: Value for property "object" is missing but there is no "optional" flag'
    //     );
    // });

    it('should FAIL to convert microdata of type "UNKNOWN" to a JS object', () => {
        function jsonFn(): string {
            return MicrodataToJSON.convertMicrodataToJSON(
                // prettier-ignore
                [
                    '<div itemscope itemtype="//refin.io/UNKNOWN">',
                        '<span itemprop="email">winfried@mail.com</span>',
                    '</div>'
                ].join('')
            );
        }

        expect(jsonFn).to.throw(Error, 'Type "UNKNOWN" not found in recipes');
    });

    // The microdata-to-json converter does FAIL to check the validity of JSON strings in values
    // because it would have to decode them, which does not seem worth the effort. The whole
    // point of this module is to save the effort of conversion but instead go straight from
    // (microdata) string to (JSON) string.
    // it('should FAIL to convert microdata with invalid JSON to a JS object', () => {
    //     const jsonFn = () => MicrodataToJSON.convertMicrodataToJSON([
    //         '<div itemscope itemtype="//refin.io/OneTest$ImapAccount">',
    //             '<span itemprop="email">winfried@mail.com</span>',
    //             '<span itemprop="host">www.mail.com</span>',
    //             '<span itemprop="user">mail</span>',
    //             '<span itemprop="tlsOptions">{not a valid json string}</span>',
    //         '</span>'
    //     ].join(''));
    //
    //     expect(jsonFn).to.throw(SyntaxError, 'foo);
    // });

    it('should FAIL to convert broken HTML in a microdata "OneTest$Email" object to a JS object', () => {
        function jsonFn(): string {
            return MicrodataToJSON.convertMicrodataToJSON(
                // prettier-ignore
                '<div itemscope itemtype="//refin.io/OneTest$Email"' +
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
        }

        expect(jsonFn).to.throw(
            Error,
            'Type "OneTest$Email"<span itemprop="messageID" not found in recipes'
        );
    });

    // TODO have a second look there, it not throwing any error because every field after it is
    //  optional, so undefined is fine ...
    // it.skip(
    //     'should FAIL to convert microdata with an unknown tag to a JS object',
    //     () => {
    // function jsonFn(): string {
    //     const a = MicrodataToJSON.convertMicrodataToJSON(
    //         [
    //             '<div itemscope itemtype="//refin.io/OneTest$Email">',
    //             '<span itemprop="messageID">dummy-123.123@dummy.com</span>',
    //             '<span itemprop="fake">UNKNOWN TAG</span>',
    //             '<ol itemprop="from">',
    //             '<li>',
    //             '<a
    //            data-type="id">cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
    //             '</li>',
    //             '</ol>',
    //             '<ol itemprop="to">',
    //             '<li>',
    //             '<a
    //            data-type="id">1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
    //             '</li>',
    //             '<li>',
    //             '<a
    //            data-type="id">aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208</a>',
    //             '</li>',
    //             '</ol>',
    //             '<span itemprop="date">1438418318001</span>',
    //             '<span itemprop="subject">Zwei Anhänge</span>',
    //             '<a itemprop="html"
    //            data-type="clob">7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4</a>',
    //             '<a itemprop="text"
    //            data-type="blob">0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</a>',
    //             '<ol itemprop="attachment">',
    //             '<li>',
    //             '<a
    //            data-type="blob">7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71</a>',
    //             '</li>',
    //             '<li>',
    //             '<a
    //            data-type="blob">d621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965</a>',
    //             '</li>',
    //             '</ol>',
    //             '<a itemprop="rawEmail"
    //            data-type="blob">59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95</a>',
    //             '</div>'
    //         ].join('')
    //     );
    //     console.log(a);
    //     return a;
    // }
    // expect(jsonFn).to.throw(Error, 'M2O-PV1: Property "html" is not a valid hash:"pan>"');
    // });

    it('should convert microdata with similar property names into JS object', async () => {
        const host = 'imap.gmail.com';
        const user = 'foo.bar@gmail.com';

        const imapAcctIdHash = await ObjectUtils.calculateIdHashOfObj({
            $type$: 'OneTest$ImapAccount',
            host,
            user
        });

        const inboxIdHash = await ObjectUtils.calculateIdHashOfObj({
            $type$: 'OneTest$Mailbox',
            account: imapAcctIdHash,
            name: 'INBOX'
        });

        const sentIdHash = await ObjectUtils.calculateIdHashOfObj({
            $type$: 'OneTest$Mailbox',
            account: imapAcctIdHash,
            name: 'Sent'
        });

        const json = MicrodataToJSON.convertMicrodataToJSON(
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

        expect(json).to.equal(
            stringify({
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
            })
        );
    });

    it('should convert "OneTest$TypeTest" microdata to object', () => {
        const json = MicrodataToJSON.convertMicrodataToJSON(
            // prettier-ignore
            '<div itemscope itemtype="//refin.io/OneTest$TypeTest">' +
                '<ol itemprop="string">' +
                    '<li>winfried</li>' +
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
                '<span itemprop="object">[{"array":[1,2,3],"bar":"foo","obj":{}},[1,2,3]]</span>' +
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

        expect(json).to.deep.equal(
            // prettier-ignore
            '{' +
                '"$type$":"OneTest$TypeTest",' +
                '"boolean":[true,false],' +
                '"map":[[],[["key1","value1"],["key2","value2"]]],' +
                '"number":[123.123,42,1.2e+23,0.01],' +
                '"object":[' +
                    '{"array":[1,2,3],"bar":"foo","obj":{}},' +
                    '[1,2,3]' +
                '],' +
                '"set":[[],[1,2,3]],' +
                '"string":["winfried",""]' +
            '}'
        );
    });

    it('should convert "object" value type properties with primitive types', () => {
        const values = {
            bool: ['true', 'false'],
            str: ['"String with spaces"', '"1STRING"', '"Greek word \\"kosme\\": \\"κόσμε\\""'],
            nr: ['3.141592653589793', '42', '1.32e+23', '123.456789']
        } as const;

        for (const type of Object.keys(values)) {
            values[type as keyof typeof values].forEach((v: any, idx: number) => {
                const microdataObj = [
                    '<div itemscope itemtype="//refin.io/OneTest$TypeTest">',
                    `<span itemprop="object">${v}</span>`,
                    '</div>'
                ].join('');

                const expected = {
                    bool: [true, false],
                    str: ['String with spaces', '1STRING', 'Greek word "kosme": "κόσμε"'],
                    nr: [Math.PI, 42, 1.32e23, 123.456789]
                } as const;

                const json = MicrodataToJSON.convertMicrodataToJSON(microdataObj);

                expect(json).to.equal(`{"$type$":"OneTest$TypeTest","object":${v}}`);

                expect(JSON.parse(json)).to.deep.equal({
                    $type$: 'OneTest$TypeTest',
                    object: expected[type as keyof typeof expected][idx]
                });
            });
        }
    });

    it('should convert recursive microdata to a JS object', () => {
        const json = MicrodataToJSON.convertMicrodataToJSON(
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

        expect(json).to.equal(
            stringify({
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
            })
        );
    });

    it('should convert nested key-value map microdata to key-value map object', () => {
        const json = MicrodataToJSON.convertMicrodataToJSON(
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

        expect(json).to.deep.equal(
            stringify({
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
            })
        );

        const json2 = MicrodataToJSON.convertMicrodataToJSON(
            // prettier-ignore
            [
                '<div itemscope itemtype="//refin.io/OneTest$KeyValueMap">',
                    '<span itemprop="name">Test Map</span>',
                    '<ol itemprop="item"></ol>',
                '</div>'
            ].join('')
        );

        expect(json2).to.deep.equal(
            stringify({
                $type$: 'OneTest$KeyValueMap',
                name: 'Test Map',
                item: []
            })
        );
    });
});
