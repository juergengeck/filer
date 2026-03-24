import {expect} from 'chai';

import * as CryptoHelpers from '../../lib/system/crypto-helpers.js';
import type {SHA256Hash} from '../../lib/util/type-checks.js';
import {ensureHash, isHash} from '../../lib/util/type-checks.js';

const s1 = [
    '<div itemscope itemtype="//refin.io/OneTest$Email">',
    '<span itemprop="messageID">dummy-123.123@dummy.com</span>',
    '<ol itemprop="from">',
    '<li>',
    '<a data-type="id">cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
    '</li>',
    '</ol>',
    '<ol itemprop="to">',
    '<li>',
    '<a data-type="id">1122330746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184</a>',
    '</li>',
    '<li>',
    '<a data-type="id">aab51f866dae0a22c3114741b91cce6178f46b564829d4204a287d840c206208</a>',
    '</li>',
    '</ol>',
    '<span itemprop="date">1438418318000</span>',
    '<span itemprop="subject">Zwei Anhänge</span>',
    '<a itemprop="html" data-type="clob">7c45c413d8503a9dbd2ea8e0fb07f16c2c82ae43ee52c441bf5a396867e34fd4</a>',
    '<a itemprop="text" data-type="blob">0996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</a>',
    '<ol itemprop="attachment">',
    '<li>',
    '<a data-type="blob">7bfd3c8f5fc52dc7a7845cfb648bb1ab8350cfe05d84361a67bd7c704a403f71</a>',
    '</li>',
    '<li>',
    '<a data-type="blob">d621eab176d9e1d3a0b8f2e594d28a17d00eb9f5bfad8d6cb366915dea215965</a>',
    '</li>',
    '</ol>',
    '<a itemprop="rawEmail" data-type="blob">59a125d04ba15b790f5bf1b60115ab4a664891d7f67b41445360f56e28c23c95</a>',
    '</div>'
].join('');

describe('Crypto-helpers tests', () => {
    let testHash: SHA256Hash;

    before(async () => {
        testHash = await CryptoHelpers.createCryptoHash('foobar');
    });

    it('should create a correct SHA-256 hash', async () => {
        expect(await CryptoHelpers.createCryptoHash(s1)).to.equal(
            '8fc230b67c83304e92cadc8b20bb6267a60291b851954ec9ff02c6b774660460'
        );
    });

    it('should regex-check that string is a valid hash', () => {
        expect(isHash(testHash)).to.equal(true);
    });

    it('should regex-check that these strings are NOT valid hashes', () => {
        // too short
        expect(isHash(testHash.slice(1))).to.equal(false);
        // only lowercase
        expect(isHash('testHash'.toUpperCase())).to.equal(false);
    });

    it('should create random hexaddecimal strings of the desired length', async () => {
        expect((await CryptoHelpers.createRandomString(32)).length).to.equal(32);
        expect((await CryptoHelpers.createRandomString(481)).length).to.equal(481);
        expect((await CryptoHelpers.createRandomSHA256Hash()).length).to.equal(64);
        expect(isHash(await CryptoHelpers.createRandomSHA256Hash())).to.be.true;
        expect(ensureHash(await CryptoHelpers.createRandomSHA256Hash())).to.exist;
        expect(await CryptoHelpers.createRandomString(32)).to.not.equal(
            await CryptoHelpers.createRandomString(32)
        );
        expect(await CryptoHelpers.createRandomString(332)).to.not.equal(
            await CryptoHelpers.createRandomString(332)
        );
    });
});
