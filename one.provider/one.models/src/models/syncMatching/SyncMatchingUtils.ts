import type {
    SyncDemand,
    SyncSelectorKind,
    SyncSupply,
    SyncTrustLevel
} from '../../recipes/SyncMatchingRecipes.js';

export type SyncDeclarationSelector = Pick<
    SyncDemand,
    'contentType' | 'selectorKind' | 'selector' | 'trie'
>;

export type EvaluatedSyncMatch = {
    demand: SyncDemand;
    supply: SyncSupply;
    remoteTrustLevel: SyncTrustLevel;
    requiredTrustLevel: SyncTrustLevel;
};

const SYNC_TRUST_LEVEL_ORDER: Record<SyncTrustLevel, number> = {
    public: 0,
    'known-key': 1,
    affirmed: 2,
    delegated: 3,
    'inner-circle': 4
};

/**
 * Compare two trust levels.
 */
export function compareSyncTrustLevel(left: SyncTrustLevel, right: SyncTrustLevel): number {
    return SYNC_TRUST_LEVEL_ORDER[left] - SYNC_TRUST_LEVEL_ORDER[right];
}

/**
 * Return the stricter of the two trust levels.
 */
export function getStricterSyncTrustLevel(
    left: SyncTrustLevel,
    right: SyncTrustLevel
): SyncTrustLevel {
    return compareSyncTrustLevel(left, right) >= 0 ? left : right;
}

/**
 * Check whether the actual trust level satisfies the required minimum.
 */
export function isTrustLevelAtLeast(actual: SyncTrustLevel, minimum: SyncTrustLevel): boolean {
    return compareSyncTrustLevel(actual, minimum) >= 0;
}

/**
 * Check whether two selectors describe overlapping content.
 */
export function selectorsMatch(
    demand: SyncDeclarationSelector,
    supply: SyncDeclarationSelector
): boolean {
    if (demand.contentType !== supply.contentType) {
        return false;
    }
    if (demand.trie !== supply.trie) {
        return false;
    }

    return selectorValuesMatch(
        demand.selectorKind,
        demand.selector,
        supply.selectorKind,
        supply.selector
    );
}

/**
 * Evaluate whether a demand and supply can be matched for a remote trust level.
 */
export function evaluateSyncMatch(
    demand: SyncDemand,
    supply: SyncSupply,
    remoteTrustLevel: SyncTrustLevel
): EvaluatedSyncMatch | null {
    if (!demand.isActive || !supply.isActive) {
        return null;
    }
    if (!selectorsMatch(demand, supply)) {
        return null;
    }

    const requiredTrustLevel = getStricterSyncTrustLevel(
        demand.minTrustLevel,
        supply.minTrustLevel
    );

    if (!isTrustLevelAtLeast(remoteTrustLevel, requiredTrustLevel)) {
        return null;
    }

    return {
        demand,
        supply,
        remoteTrustLevel,
        requiredTrustLevel
    };
}

function selectorValuesMatch(
    demandKind: SyncSelectorKind,
    demandSelector: string,
    supplyKind: SyncSelectorKind,
    supplySelector: string
): boolean {
    if (demandKind === supplyKind && demandSelector === supplySelector) {
        return true;
    }

    if (demandKind === 'exact' && supplyKind === 'prefix') {
        return demandSelector.startsWith(supplySelector);
    }

    if (demandKind === 'prefix' && supplyKind === 'exact') {
        return supplySelector.startsWith(demandSelector);
    }

    if (demandKind === 'prefix' && supplyKind === 'prefix') {
        return (
            demandSelector.startsWith(supplySelector) || supplySelector.startsWith(demandSelector)
        );
    }

    return false;
}
