import type {ChildVersionTree} from '@refinio/one.core/lib/crdts/VersionTree.js';
import type {Transformation} from '@refinio/one.core/lib/crdts/interfaces/Transformation.js';
import {ensureHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {LinkedListEntry} from '../../recipes/ChannelRecipes.js';
import {CrdtAlgorithmStandard} from '@refinio/one.core/lib/crdts/interfaces/CrdtAlgorithmStandard.js';
import {linkedListMerge} from './merge.js';

export class LinkedListCrdtAlgorithm extends CrdtAlgorithmStandard {
    readonly id = 'LinkedListCrdtAlgorithm';

    initialDiff(value: unknown): Transformation[] {
        const hash = ensureHash(value);
        return [{op: 'set', value: hash}];
    }

    diff(value1: unknown, value2: unknown): Transformation[] {
        const hash1 = ensureHash(value1);
        const hash2 = ensureHash(value2);
        if (hash1 !== hash2) {
            return [{op: 'set', value: hash2}];
        } else {
            return [];
        }
    }

    async merge(
        tree: ChildVersionTree<unknown, Transformation[]>
    ): Promise<SHA256Hash<LinkedListEntry>> {
        const hash1 = ensureHash(tree.firstMergeNode.data);
        const hash2 = ensureHash(tree.secondMergeNode.data);

        return linkedListMerge(
            hash1 as SHA256Hash<LinkedListEntry>,
            hash2 as SHA256Hash<LinkedListEntry>
        );
    }
}
