import {expect} from 'chai';

import BlockingQueue from '../lib/misc/BlockingQueue.js';

// If you set this to true, then use the experimental reverseMap Replacement 'MetaObjectMap'
const experimentalReverseMaps = false;

describe('BlockingQueue test', () => {
    beforeEach(async () => {});

    afterEach(async () => {});

    it('Add data and get it', async () => {
        const q = new BlockingQueue<number>();
        q.add(5);
        q.add(10);
        expect(await q.remove()).to.be.equal(5);
        expect(await q.remove()).to.be.equal(10);
        const p1 = q.remove();
        const p2 = q.remove();
        const p3 = q.remove();
        q.add(20);
        q.add(21);
        q.add(22);
        expect(await p1).to.be.equal(20);
        expect(await p2).to.be.equal(21);
        expect(await p3).to.be.equal(22);
    });
});
