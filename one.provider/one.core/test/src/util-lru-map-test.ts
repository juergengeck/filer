import {expect} from 'chai';

import {createLruMap} from '../../lib/util/lru-map.js';

describe('LRU Map tests', () => {
    it('should create an LRU map and set and get items', () => {
        const m = createLruMap(10);

        for (let i = 0; i < 20; i++) {
            m.set(i, i);
        }

        expect([...m]).to.deep.equal([
            [10, 10],
            [11, 11],
            [12, 12],
            [13, 13],
            [14, 14],
            [15, 15],
            [16, 16],
            [17, 17],
            [18, 18],
            [19, 19]
        ]);

        // Testing the iterator property on the LruMap object itself
        expect([...m]).to.deep.equal([
            [10, 10],
            [11, 11],
            [12, 12],
            [13, 13],
            [14, 14],
            [15, 15],
            [16, 16],
            [17, 17],
            [18, 18],
            [19, 19]
        ]);

        m.set(14, 14);
        m.set(15, 15);

        expect([...m]).to.deep.equal([
            [10, 10],
            [11, 11],
            [12, 12],
            [13, 13],
            [16, 16],
            [17, 17],
            [18, 18],
            [19, 19],
            [14, 14],
            [15, 15]
        ]);

        // Testing the iterator property on the LruMap object itself
        expect([...m]).to.deep.equal([
            [10, 10],
            [11, 11],
            [12, 12],
            [13, 13],
            [16, 16],
            [17, 17],
            [18, 18],
            [19, 19],
            [14, 14],
            [15, 15]
        ]);

        expect(m.get(42)).to.be.undefined;
        expect(m.get(10)).to.equal(10);
    });
});
