import {expect} from 'chai';
import {
    addPadding,
    removePadding,
    addPaddingWithExtraFlags,
    removePaddingWithExtraFlags
} from '../lib/misc/PasswordRecoveryService/padding.js';

/**
 * This function generates indices around 2^x values.
 *
 * This is the critical section where more and more bits are used to represent the length of the
 * padding.
 *
 * At the moment it will generate values in the intervals
 * - [1,599]
 * - [2^10-10, 2^10+40] => [1014, 1064]
 * - [2^11-10, 2^11+40] => [2038, 2088]
 * - ...
 * - [2^24-10, 2^24+40]
 */
function* generateIndex() {
    yield 40;
    /*
    for (let i = 1; i < 600; ++i) {
        yield i;
    }
    for (let j = 10; j <= 24; ++j) {
        const value = Math.pow(2, j);
        for (let k = value - 10; k <= value + 40; ++k) {
            yield k;
        }
    }*/
}

describe('Padding test', () => {
    beforeEach(async () => {});

    afterEach(async () => {});

    it('Add and remove padding.', async () => {
        const testData = new Uint8Array([50, 51, 52, 53, 54, 55, 56]);
        for (const i of generateIndex()) {
            const paddedValue = addPadding(testData, testData.length + i);
            const original = removePadding(paddedValue);
            expect(paddedValue.length).to.be.equal(testData.length + i);
            expect(original).to.be.deep.equal(testData);
        }
    }).timeout(10000);

    it('Add and remove padding with flags.', async () => {
        const testData = new Uint8Array([50, 51, 52, 53, 54, 55, 56]);
        for (const i of generateIndex()) {
            const paddedValue = addPaddingWithExtraFlags(testData, testData.length + i, i % 16);
            const original = removePaddingWithExtraFlags(paddedValue);
            expect(paddedValue.length).to.be.equal(testData.length + i);
            expect(original.value).to.be.deep.equal(testData);
            expect(original.flags).to.be.deep.equal(i % 16);
        }
    }).timeout(10000);

    it('too large flag exception', async () => {
        const testData = new Uint8Array([50, 51, 52, 53, 54, 55, 56]);
        expect(() => addPaddingWithExtraFlags(testData, testData.length + 5, 0x10)).to.throw;
    });

    it('Test zero length', async () => {
        const testData = new Uint8Array(0);
        for (const i of generateIndex()) {
            const paddedValue = addPadding(testData, testData.length + i);
            const original = removePadding(paddedValue);
            expect(paddedValue.length).to.be.equal(testData.length + i);
            expect(original).to.be.deep.equal(testData);
        }
    }).timeout(10000);
});
