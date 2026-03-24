import type {BLOB, CLOB, ValueType} from '../../recipes.js';
import type {OneObjectTypes} from '../../recipes.js';
import type {SHA256Hash, SHA256IdHash} from '../../util/type-checks.js';
import type {ChildVersionTree} from '../VersionTree.js';
import type {CrdtAlgorithm} from './CrdtAlgorithm.js';
import type {Transformation} from './Transformation.js';

export type OneDataTypes =
    | string
    | boolean
    | number
    | unknown[]
    | Set<unknown>
    | Map<string, unknown>
    | Record<string, unknown>
    | SHA256Hash<BLOB | CLOB | OneObjectTypes>
    | SHA256IdHash;

export abstract class CrdtAlgorithmStandard<T extends OneDataTypes = OneDataTypes> {
    abstract readonly id: string;
    readonly algoType = 'Standard';

    abstract initialDiff(
        obj: T,
        valueType: ValueType
    ): Transformation[] | Promise<Transformation[]>;

    abstract diff(
        obj1: T,
        obj2: T,
        valueType: ValueType
    ): Transformation[] | Promise<Transformation[]>;

    abstract merge(
        tree: ChildVersionTree<T, Transformation[]>,
        valueType: ValueType
    ): T | Promise<T>;
}

export function isStandardCrdtAlgorithm<T extends OneDataTypes = OneDataTypes>(
    algo: CrdtAlgorithm
): algo is CrdtAlgorithmStandard<T> {
    return algo.algoType === 'Standard';
}
