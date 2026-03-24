import type {ChangeGraphNode, ChildVersionTree, RootGraphNode} from '../VersionTree.js';
import type {SHA256Hash} from '../../util/type-checks.js';
import {
    CrdtAlgorithmReferenceToObject,
    type ReferenceToObjectMergeResult
} from '../interfaces/CrdtAlgorithmReferenceToObject.js';
import type {HashAndObject} from '../interfaces/HashAndObj.js';
import type {Transformation} from '../interfaces/Transformation.js';

export class CrdtReferenceToObj extends CrdtAlgorithmReferenceToObject {
    readonly id: string = 'ReferenceToObj';

    initialDiff(hashAndObj: HashAndObject): Transformation[] {
        return [
            {
                op: 'set',
                value: hashAndObj.hash
            }
        ];
    }

    diff(hashAndObj1: HashAndObject, hashAndObj2: HashAndObject): Transformation[] {
        return hashAndObj1.obj.$type$ === hashAndObj2.obj.$type$
            ? []
            : [
                  {
                      op: 'set',
                      value: hashAndObj2.hash
                  }
              ];
    }

    merge(tree: ChildVersionTree<SHA256Hash, Transformation[]>): ReferenceToObjectMergeResult {
        if (tree.firstMergeNode.dataType === undefined) {
            throw new Error('Child has no dataType member');
        }

        const hasSetTransformation = (
            node:
                | ChangeGraphNode<SHA256Hash, Transformation[]>
                | RootGraphNode<SHA256Hash, Transformation[]>
        ): boolean => {
            return node.predecessorDiff.filter(t => t.op === 'set').length > 0;
        };

        const firstSetNode = tree.findMaximumPredecessingTopLevelNode(
            tree.firstMergeNode,
            hasSetTransformation,
            CrdtReferenceToObj.compareFn
        );

        const secondSetNode = tree.findMaximumPredecessingTopLevelNode(
            tree.secondMergeNode,
            hasSetTransformation,
            CrdtReferenceToObj.compareFn
        );

        if (firstSetNode === secondSetNode) {
            if (firstSetNode === undefined) {
                // This means, that no type change happened since common history
                // => iterate into children to merge
                return {
                    action: 'iterate',
                    tree: tree.parentVersionTree,
                    type: tree.firstMergeNode.dataType
                };
            } else {
                // This means, that no type change happened since last node with 'set' operation.
                // => Trimming tree of information of other types
                // => iterate into children to merge
                return {
                    action: 'iterate',
                    tree: tree.parentVersionTree.createNewTreeWithNewCommonHistory(
                        tree.parentVersionTree.nodeByHash(firstSetNode.hash)
                    ),
                    type: tree.firstMergeNode.dataType
                };
            }
        } else {
            // Type change happened => no merge of children, just pick one of the already
            // calculated hashes based on priority.
            return {
                action: 'set',
                value:
                    CrdtReferenceToObj.compareFn(firstSetNode, secondSetNode) > 0
                        ? tree.firstMergeNode.data
                        : tree.secondMergeNode.data
            };
        }
    }

    static compareFn(
        node1:
            | RootGraphNode<SHA256Hash, Transformation[]>
            | ChangeGraphNode<SHA256Hash, Transformation[]>
            | undefined,
        node2:
            | RootGraphNode<SHA256Hash, Transformation[]>
            | ChangeGraphNode<SHA256Hash, Transformation[]>
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
        const node1HasOp = node1.predecessorDiff.length > 0;
        const node2HasOp = node2.predecessorDiff.length > 0;

        if (node1HasOp !== node2HasOp) {
            if (node1HasOp) {
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
