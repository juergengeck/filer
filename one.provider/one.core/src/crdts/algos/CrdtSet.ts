import {convertValueByType} from '../../object-to-microdata.js';
import type {ArrayValue, BagValue, SetValue, ValueType} from '../../recipes.js';
import type {ChangeGraphNode, RootGraphNode} from '../VersionTree.js';
import type {ChildVersionTree} from '../VersionTree.js';
import {CrdtAlgorithmStandard, type OneDataTypes} from '../interfaces/CrdtAlgorithmStandard.js';
import type {Transformation} from '../interfaces/Transformation.js';

interface SetTransformation {
    op: 'add' | 'remove' | 'keep';
    value: string;
    data: unknown;
}

export class CrdtSet extends CrdtAlgorithmStandard {
    readonly id = 'Set';

    initialDiff(origData: OneDataTypes, origValueType: ValueType): Transformation[] {
        const {data, valueType} = CrdtSet.convertInputValues(origValueType, origData);

        const transformations: Transformation[] = [];

        for (const value of data) {
            transformations.push({
                op: 'add',
                value: CrdtSet.valueToString('CRDTSET.INITIALDIFF', value, valueType.item)
            });
        }

        return transformations;
    }

    diff(
        origData1: OneDataTypes,
        origData2: OneDataTypes,
        origValueType: ValueType
    ): Transformation[] {
        const {data1, data2, valueType} = CrdtSet.convertInputValues(
            origValueType,
            origData1,
            origData2
        );

        const transformations = this.diffWithData(data1, data2, valueType, 'CRDTSET.DIFF');
        const result: Transformation[] = [];

        for (const t of transformations) {
            if (t.op === 'keep') {
                continue;
            }

            result.push({op: t.op, value: t.value});
        }

        return result;
    }

    merge(
        tree: ChildVersionTree<Set<unknown> | unknown[], Transformation[]>,
        origValueType: ValueType
    ): Set<unknown> | unknown[] {
        const {
            data1: firstData,
            data2: secondData,
            valueType
        } = CrdtSet.convertInputValues(
            origValueType,
            tree.firstMergeNode.data,
            tree.secondMergeNode.data
        );

        const result = new Set();

        for (const trans of this.diffWithData(firstData, secondData, valueType, 'CRDTSET.MERGE')) {
            if (trans.op === 'keep') {
                result.add(trans.data);
                continue;
            }

            const hasTransformation = (
                node:
                    | ChangeGraphNode<unknown, Transformation[]>
                    | RootGraphNode<unknown, Transformation[]>
            ): boolean => {
                return (
                    node.predecessorDiff.filter(
                        t => (t.op === 'add' || t.op === 'remove') && t.value === trans.value
                    ).length > 0
                );
            };

            // Follow all branches from the merge nodes, until a node with a transition was found that
            // has no succeeding transformations
            const firstOpNode = tree.findMaximumPredecessingTopLevelNode(
                tree.firstMergeNode,
                hasTransformation,
                CrdtSet.compareFn.bind(null, trans.value)
            );
            const firstOpNodeHasAdd =
                firstOpNode === undefined
                    ? false
                    : firstOpNode.predecessorDiff.some(
                          t => t.op === 'add' && t.value === trans.value
                      );
            const firstOpNodeHasRemove =
                firstOpNode === undefined
                    ? false
                    : firstOpNode.predecessorDiff.some(
                          t => t.op === 'remove' && t.value === trans.value
                      );

            const secondOpNode = tree.findMaximumPredecessingTopLevelNode(
                tree.secondMergeNode,
                hasTransformation,
                CrdtSet.compareFn.bind(null, trans.value)
            );
            const secondOpNodeHasAdd =
                secondOpNode === undefined
                    ? false
                    : secondOpNode.predecessorDiff.some(
                          t => t.op === 'add' && t.value === trans.value
                      );
            const secondOpNodeHasRemove =
                secondOpNode === undefined
                    ? false
                    : secondOpNode.predecessorDiff.some(
                          t => t.op === 'remove' && t.value === trans.value
                      );

            if (firstOpNode === secondOpNode) {
                if (firstOpNode === undefined) {
                    // This means, that no operations happened since the common history, so we
                    // use the value from there.
                    if (tree.commonHistoryNode.type !== 'empty') {
                        const strSet = new Set(
                            [...tree.commonHistoryNode.data].map(value =>
                                CrdtSet.valueToString('CRDTSET.MERGE', value, valueType.item)
                            )
                        );

                        if (strSet.has(trans.value)) {
                            result.add(trans.data);
                        }
                    }
                } else if (firstOpNodeHasAdd) {
                    result.add(trans.data);
                } else if (firstOpNodeHasRemove) {
                    // Do nothing -> will not be part of the result set
                } else {
                    throw new Error('firstOpNode has no set and no delete');
                }
            } else {
                // Type optional change happened => no merge of children, just pick one of the already
                // calculated hashes based on priority.
                const firstWins = CrdtSet.compareFn(trans.value, firstOpNode, secondOpNode) > 0;

                const hasAdd = firstWins ? firstOpNodeHasAdd : secondOpNodeHasAdd;
                const hasRemove = firstWins ? firstOpNodeHasRemove : secondOpNodeHasRemove;

                if (hasAdd) {
                    result.add(trans.data);
                } else if (hasRemove) {
                    // Do nothing -> will not be part of the result set
                } else {
                    throw new Error(
                        `${firstWins ? 'firstOpNode' : 'secondOpNode'} has no set and no delete`
                    );
                }
            }
        }

        if (valueType.type === 'set') {
            return result;
        } else {
            return [...result];
        }
    }

    private diffWithData(
        data1: Set<unknown> | unknown[],
        data2: Set<unknown> | unknown[],
        valueType: SetValue | BagValue | ArrayValue,
        debugPropId: string
    ): SetTransformation[] {
        const transformations: SetTransformation[] = [];

        const set1StrAndObj = new Map(
            [...data1].map(value => [
                convertValueByType(value, debugPropId, valueType.item, true),
                value
            ])
        );
        const set2StrAndObj = new Map(
            [...data2].map(value => [
                convertValueByType(value, debugPropId, valueType.item, true),
                value
            ])
        );

        for (const [value, data] of set1StrAndObj) {
            if (set2StrAndObj.has(value)) {
                transformations.push({op: 'keep', value, data});
            } else {
                transformations.push({op: 'remove', value, data});
            }
        }

        for (const [value, data] of set2StrAndObj) {
            if (!set1StrAndObj.has(value)) {
                transformations.push({op: 'add', value, data});
            }
        }

        return transformations;
    }

    static compareFn(
        value: string,
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
        const node1HasAddOp =
            node1.predecessorDiff.findIndex(op => op.op === 'add' && op.value === value) !== -1;
        const node1HasRemoveOp =
            node1.predecessorDiff.findIndex(op => op.op === 'remove' && op.value === value) !== -1;
        const node2HasAddOp =
            node2.predecessorDiff.findIndex(op => op.op === 'add' && op.value === value) !== -1;
        const node2HasRemoveOp =
            node2.predecessorDiff.findIndex(op => op.op === 'remove' && op.value === value) !== -1;

        if (node1HasAddOp !== node2HasAddOp) {
            if (node1HasAddOp) {
                return 1;
            } else {
                return -1;
            }
        } else if (node1HasRemoveOp !== node2HasRemoveOp) {
            if (node1HasRemoveOp) {
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

    static valueToString(debugProp: string, value: unknown, vt: ValueType): string {
        return convertValueByType(value, debugProp, vt, true);
    }

    static convertInputValues(
        valueType: ValueType,
        origData1: OneDataTypes
    ): {
        data: Set<unknown> | unknown[];
        valueType: SetValue | BagValue | ArrayValue;
    };

    static convertInputValues(
        valueType: ValueType,
        origData1: OneDataTypes,
        origData2: OneDataTypes
    ): {
        data1: Set<unknown> | unknown[];
        data2: Set<unknown> | unknown[];
        valueType: SetValue | BagValue | ArrayValue;
    };

    static convertInputValues(
        valueType: ValueType,
        origData1: OneDataTypes,
        origData2?: OneDataTypes
    ): {
        data?: Set<unknown> | unknown[];
        data1?: Set<unknown> | unknown[];
        data2?: Set<unknown> | unknown[];
        valueType: SetValue | BagValue | ArrayValue;
    } {
        if (valueType.type !== 'bag' && valueType.type !== 'array' && valueType.type !== 'set') {
            throw new Error(
                'This crdt algorithm only supports containers "bag", "array" and "set"'
            );
        }

        let data1;
        let data2;

        if (valueType.type === 'bag' || valueType.type === 'array') {
            if (!Array.isArray(origData1)) {
                throw new Error('Data1 for bag and array must be an array');
            }

            if (!Array.isArray(origData2) && origData2 !== undefined) {
                throw new Error('Data2 for bag and array must be an array');
            }

            data1 = origData1;
            data2 = origData2;
        } else {
            if (!(origData1 instanceof Set)) {
                throw new Error('Passed data1 is not a set');
            }

            if (!(origData2 instanceof Set) && origData2 !== undefined) {
                throw new Error('Passed data2 is not a set');
            }

            data1 = origData1;
            data2 = origData2;
        }

        if (origData2 === undefined) {
            return {
                data: data1,
                valueType
            };
        } else {
            return {
                data1,
                data2,
                valueType
            };
        }
    }
}
