import type {VersionTree, ChildVersionTree} from '../VersionTree.js';
import type {CrdtAlgorithm} from './CrdtAlgorithm.js';
import type {Transformation} from './Transformation.js';

export type OptionalValueMergeResult =
    | {action: 'set'; value: unknown}
    | {action: 'delete'}
    | {action: 'iterate'; tree: VersionTree};

export abstract class CrdtAlgorithmOptionalValue {
    abstract readonly id: string;
    readonly algoType = 'OptionalValue';

    abstract initialDiff(obj: unknown): Transformation[] | Promise<Transformation[]>;

    abstract diff(obj1: unknown, obj2: unknown): Transformation[] | Promise<Transformation[]>;

    abstract merge(
        tree: ChildVersionTree<unknown, Transformation[]>
    ): OptionalValueMergeResult | Promise<OptionalValueMergeResult>;
}

export function isOptionalValueCrdtAlgorithm(
    algo: CrdtAlgorithm
): algo is CrdtAlgorithmOptionalValue {
    return algo.algoType === 'OptionalValue';
}
