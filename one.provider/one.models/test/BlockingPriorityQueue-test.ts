import {expect} from 'chai';

import BlockingPriorityQueue from '../lib/misc/BlockingPriorityQueue.js';

describe('BlockingQueue test', () => {
    beforeEach(async () => {});

    afterEach(async () => {});

    it('Add data and get it', async () => {
        const q = new BlockingPriorityQueue<string>();
        q.add('e', 2);
        q.add('l', 4);
        q.add('h', 1);
        q.add('o', 5);
        q.add('l', 3);
        q.add('!', 5);

        let result = '';

        while (q.length > 0) {
            result += await q.remove();
        }

        expect(result).to.be.equal('hello!');
    });
});
