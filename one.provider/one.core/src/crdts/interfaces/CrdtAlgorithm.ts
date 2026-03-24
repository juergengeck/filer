import type {CrdtAlgorithmNotAvailable} from './CrdtAlgorithmNotAvailable.js';
import type {CrdtAlgorithmOptionalValue} from './CrdtAlgorithmOptionalValue.js';
import type {CrdtAlgorithmReferenceToObject} from './CrdtAlgorithmReferenceToObject.js';
import type {CrdtAlgorithmStandard} from './CrdtAlgorithmStandard.js';

export type CrdtAlgorithm =
    | CrdtAlgorithmStandard
    | CrdtAlgorithmOptionalValue
    | CrdtAlgorithmReferenceToObject
    | CrdtAlgorithmNotAvailable;
