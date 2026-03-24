import {convertValueByType} from '../../object-to-microdata.js';
import type {ValueType} from '../../recipes.js';
import {arrayMax} from '../../util/array.js';
import type {ChangeGraphNode, ChildVersionTree, RootGraphNode} from '../VersionTree.js';
import {CrdtAlgorithmStandard, type OneDataTypes} from '../interfaces/CrdtAlgorithmStandard.js';
import type {Transformation} from '../interfaces/Transformation.js';

export class CrdtRegister extends CrdtAlgorithmStandard {
    readonly id = 'Register';

    initialDiff(obj: OneDataTypes, valueType: ValueType): Transformation[] {
        function toString(value: OneDataTypes): string {
            return convertValueByType(value, 'INITIALDIFF.CrdtRegister', valueType, true);
        }

        return [
            {
                op: 'set',
                value: toString(obj)
            }
        ];
    }

    diff(obj1: OneDataTypes, obj2: OneDataTypes, valueType: ValueType): Transformation[] {
        function toString(value: OneDataTypes): string {
            return convertValueByType(value, 'DIFF.CrdtRegister', valueType, true);
        }

        const obj1Str = toString(obj1);
        const obj2Str = toString(obj2);

        return obj1Str === obj2Str
            ? []
            : [
                  {
                      op: 'set',
                      value: obj2Str
                  }
              ];
    }

    merge(tree: ChildVersionTree<OneDataTypes, Transformation[]>): OneDataTypes {
        if (tree.firstMergeNode.dataType !== undefined) {
            throw new Error('Child has no dataType member');
        }

        const hasSetTransformation = (
            node:
                | ChangeGraphNode<unknown, Transformation[]>
                | RootGraphNode<unknown, Transformation[]>
        ): boolean => {
            return node.predecessorDiff.filter(t => t.op === 'set').length > 0;
        };

        const firstSetNode = tree.findMaximumPredecessingTopLevelNode(
            tree.firstMergeNode,
            hasSetTransformation,
            CrdtRegister.compareFn
        );

        const secondSetNode = tree.findMaximumPredecessingTopLevelNode(
            tree.secondMergeNode,
            hasSetTransformation,
            CrdtRegister.compareFn
        );

        // Just use the value of the node with the highest priority
        const winningNode = arrayMax([firstSetNode, secondSetNode], CrdtRegister.compareFn);

        // Not sure if this case can even happen, because if winningNode is undefined, no
        // value was set, so the only predecessor would be empty => no merge would happen
        if (winningNode === undefined) {
            if (tree.commonHistoryNode.type === 'empty') {
                throw new Error(
                    'CrdtRegister.merge: winning node is undefined and common history empty.'
                );
            }

            return tree.commonHistoryNode.data;
        }

        if (winningNode.data === undefined) {
            throw new Error('CrdtRegister.merge: winning node has no data.');
        }

        return winningNode.data;
    }

    static compareFn(
        node1:
            | RootGraphNode<unknown, Transformation[]>
            | ChangeGraphNode<unknown, Transformation[]>
            | undefined,
        node2:
            | RootGraphNode<unknown, Transformation[]>
            | ChangeGraphNode<unknown, Transformation[]>
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
