import type {CrdtAlgorithm} from './CrdtAlgorithm.js';

export class CrdtAlgorithmNotAvailable {
    readonly id: string = 'NotAvailable';
    readonly algoType = 'NotAvailable';
}

export function isNotAvailableCrdtAlgorithm(
    algo: CrdtAlgorithm
): algo is CrdtAlgorithmNotAvailable {
    return algo.algoType === 'NotAvailable';
}
