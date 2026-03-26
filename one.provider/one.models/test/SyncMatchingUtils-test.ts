import {expect} from 'chai';
import {
    compareSyncTrustLevel,
    evaluateSyncMatch,
    selectorsMatch
} from '../lib/models/syncMatching/SyncMatchingUtils.js';
import type {SyncDemand, SyncSupply} from '../lib/recipes/SyncMatchingRecipes.js';

function createDemand(overrides: Partial<SyncDemand> = {}): SyncDemand {
    return {
        $type$: 'SyncDemand',
        id: 'demand-1',
        owner: 'a'.repeat(64) as SyncDemand['owner'],
        instanceId: 'b'.repeat(64) as SyncDemand['instanceId'],
        contentType: 'chat.message',
        selectorKind: 'exact',
        selector: 'topic:alpha',
        trie: 'sync',
        minTrustLevel: 'affirmed',
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
        ...overrides
    };
}

function createSupply(overrides: Partial<SyncSupply> = {}): SyncSupply {
    return {
        $type$: 'SyncSupply',
        id: 'supply-1',
        owner: 'c'.repeat(64) as SyncSupply['owner'],
        instanceId: 'd'.repeat(64) as SyncSupply['instanceId'],
        contentType: 'chat.message',
        selectorKind: 'exact',
        selector: 'topic:alpha',
        trie: 'sync',
        scopedRoot: 'e'.repeat(64) as SyncSupply['scopedRoot'],
        minTrustLevel: 'known-key',
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
        ...overrides
    };
}

describe('SyncMatchingUtils', () => {
    it('orders trust levels from lower to higher trust', function () {
        expect(compareSyncTrustLevel('public', 'known-key')).to.be.lessThan(0);
        expect(compareSyncTrustLevel('delegated', 'affirmed')).to.be.greaterThan(0);
        expect(compareSyncTrustLevel('inner-circle', 'inner-circle')).to.equal(0);
    });

    it('matches exact selectors with the same content type and trie', function () {
        expect(selectorsMatch(createDemand(), createSupply())).to.equal(true);
    });

    it('matches prefix supply to exact demand', function () {
        const demand = createDemand({selector: 'topic:alpha/thread:01'});
        const supply = createSupply({selectorKind: 'prefix', selector: 'topic:alpha'});

        expect(selectorsMatch(demand, supply)).to.equal(true);
    });

    it('rejects mismatched trust levels', function () {
        const demand = createDemand({minTrustLevel: 'delegated'});
        const supply = createSupply({minTrustLevel: 'affirmed'});

        expect(evaluateSyncMatch(demand, supply, 'affirmed')).to.equal(null);
        expect(evaluateSyncMatch(demand, supply, 'delegated')).not.to.equal(null);
    });

    it('rejects inactive declarations', function () {
        const demand = createDemand({isActive: false});

        expect(evaluateSyncMatch(demand, createSupply(), 'inner-circle')).to.equal(null);
    });
});
