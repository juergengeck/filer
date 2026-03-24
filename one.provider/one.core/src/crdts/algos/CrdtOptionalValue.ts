import type {ChangeGraphNode, RootGraphNode} from '../VersionTree.js';
import type {ChildVersionTree} from '../VersionTree.js';
import {
    CrdtAlgorithmOptionalValue,
    type OptionalValueMergeResult
} from '../interfaces/CrdtAlgorithmOptionalValue.js';
import type {Transformation} from '../interfaces/Transformation.js';

export class CrdtOptionalValue extends CrdtAlgorithmOptionalValue {
    readonly id = 'OptionalValue';

    initialDiff(value: unknown): Transformation[] {
        if (value !== undefined) {
            return [{op: 'set'}];
        }

        return [];
    }

    diff(value1: unknown, value2: unknown): Transformation[] {
        if (value1 === undefined && value2 !== undefined) {
            return [{op: 'set'}];
        }

        if (value1 !== undefined && value2 === undefined) {
            return [{op: 'delete'}];
        }

        return [];
    }

    merge(tree: ChildVersionTree<unknown, Transformation[]>): OptionalValueMergeResult {
        const hasTransformation = (
            node:
                | ChangeGraphNode<unknown, Transformation[]>
                | RootGraphNode<unknown, Transformation[]>
        ): boolean => {
            return node.predecessorDiff.some(t => t.op === 'set' || t.op === 'delete');
        };

        const firstTopLevelNodes = tree.findPredecessingTopLevelNodes(
            tree.firstMergeNode,
            hasTransformation
        );

        const secondTopLevelNodes = tree.findPredecessingTopLevelNodes(
            tree.secondMergeNode,
            hasTransformation
        );

        // Just keep the nodes that have a 'set' operation
        const firstTopLevelSetNodes = firstTopLevelNodes.filter(n =>
            n.predecessorDiff.some(t => t.op === 'set')
        );

        const secondTopLevelSetNodes = secondTopLevelNodes.filter(n =>
            n.predecessorDiff.some(t => t.op === 'set')
        );

        const topLevelSetNodes = firstTopLevelSetNodes.concat(secondTopLevelSetNodes);

        // If there are no top level set nodes , then there are only delete nodes left or none
        // (default => undefined)
        if (topLevelSetNodes.length === 0) {
            const commonHistory = tree.commonHistoryNode;

            if (commonHistory.type === 'empty' || commonHistory.data === undefined) {
                return {
                    action: 'delete'
                };
            }

            return {
                action: 'iterate',
                tree: tree.parentVersionTree
            };
        }

        return {
            action: 'iterate',
            tree: tree.parentVersionTree.createNewTreeWithNewCommonHistoryNodes(topLevelSetNodes)
        };
    }

    static compareFn(
        node1:
            | ChangeGraphNode<unknown, Transformation[]>
            | RootGraphNode<unknown, Transformation[]>
            | undefined,
        node2:
            | ChangeGraphNode<unknown, Transformation[]>
            | RootGraphNode<unknown, Transformation[]>
            | undefined
    ): number {
        // Handle undefined case
        if (node1 === undefined && node2 === undefined) {
            return 0;
        } else if (node1 === undefined) {
            return -1;
        } else if (node2 === undefined) {
            return 1;
        }

        // Check if transition exists
        const node1HasSetOp = node1.predecessorDiff.findIndex(op => op.op === 'set') !== -1;
        const node1HasDeleteOp = node1.predecessorDiff.findIndex(op => op.op === 'delete') !== -1;
        const node2HasSetOp = node2.predecessorDiff.findIndex(op => op.op === 'set') !== -1;
        const node2HasDeleteOp = node2.predecessorDiff.findIndex(op => op.op === 'delete') !== -1;

        if (node1HasSetOp !== node2HasSetOp) {
            if (node1HasSetOp) {
                return 1;
            } else {
                return -1;
            }
        } else if (node1HasDeleteOp !== node2HasDeleteOp) {
            if (node1HasDeleteOp) {
                return 1;
            } else {
                return -1;
            }
        }

        // Check creation time
        if (node1.obj.creationTime > node2.obj.creationTime) {
            return 1;
        } else if (node1.obj.creationTime < node2.obj.creationTime) {
            return -1;
        }

        // Last resort compare data pointed to
        if (node1.hash > node2.hash) {
            return 1;
        } else if (node1.hash < node2.hash) {
            return -1;
        }

        return 0;
    }
}
