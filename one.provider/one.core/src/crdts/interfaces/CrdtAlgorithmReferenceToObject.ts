import type {OneObjectTypeNames} from '../../recipes.js';
import type {SHA256Hash} from '../../util/type-checks.js';
import type {VersionTree} from '../VersionTree.js';
import type {ChildVersionTree} from '../VersionTree.js';
import type {CrdtAlgorithm} from './CrdtAlgorithm.js';
import type {HashAndObject} from './HashAndObj.js';
import type {Transformation} from './Transformation.js';

export type ReferenceToObjectMergeResult =
    | {action: 'set'; value: SHA256Hash}
    | {action: 'iterate'; tree: VersionTree; type: OneObjectTypeNames};

export abstract class CrdtAlgorithmReferenceToObject {
    abstract readonly id: string;
    readonly algoType = 'ReferenceToObject';

    abstract initialDiff(obj: HashAndObject): Transformation[] | Promise<Transformation[]>;

    abstract diff(
        obj1: HashAndObject,
        obj2: HashAndObject
    ): Transformation[] | Promise<Transformation[]>;

    abstract merge(
        tree: ChildVersionTree<SHA256Hash, Transformation[]>
    ): ReferenceToObjectMergeResult | Promise<ReferenceToObjectMergeResult>;
}

export function isReferenceToObjectCrdtAlgorithm(
    algo: CrdtAlgorithm
): algo is CrdtAlgorithmReferenceToObject {
    return algo.algoType === 'ReferenceToObject';
}
