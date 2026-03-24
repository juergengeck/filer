import type {ValueType} from '../recipes.js';
import type {CrdtAlgorithm} from './interfaces/CrdtAlgorithm.js';
import {CrdtOptionalValue} from './algos/CrdtOptionalValue.js';
import {CrdtReferenceToObj} from './algos/CrdtReferenceToObj.js';
import {CrdtRegister} from './algos/CrdtRegister.js';
import {CrdtSet} from './algos/CrdtSet.js';
import {CrdtAlgorithmNotAvailable} from './interfaces/CrdtAlgorithmNotAvailable.js';

export type CrdtTypes = ValueType['type'] | 'mapEntry' | 'objectProperty';

// #### Default crdt algorithm ids ####

const defaultCrdtAlgorithms = new Map<CrdtTypes, string>([
    ['string', 'Register'],
    ['integer', 'Register'],
    ['number', 'Register'],
    ['boolean', 'Register'],
    ['referenceToObj', 'ReferenceToObj'],
    ['referenceToId', 'Register'],
    ['referenceToClob', 'Register'],
    ['referenceToBlob', 'Register'],
    ['map', 'NotAvailable'],
    ['mapEntry', 'OptionalValue'],
    ['bag', 'Set'],
    ['array', 'Set'],
    ['set', 'Set'],
    ['object', 'NotAvailable'],
    ['objectProperty', 'OptionalValue'],
    ['stringifiable', 'Register']
]);

export function getDefaultCrdtAlgorithmId(type: CrdtTypes): string {
    const algoId = defaultCrdtAlgorithms.get(type);

    if (algoId === undefined) {
        throw new Error(`Default algorithm for type ${type} does not exist.`);
    }

    return algoId;
}

// #### Algorithm management ####

const crdtAlgorithms = new Map<string, CrdtAlgorithm>();

registerCrdtAlgorithm(new CrdtOptionalValue());
registerCrdtAlgorithm(new CrdtReferenceToObj());
registerCrdtAlgorithm(new CrdtRegister());
registerCrdtAlgorithm(new CrdtSet());
registerCrdtAlgorithm(new CrdtAlgorithmNotAvailable());

export function registerCrdtAlgorithm(algorithm: CrdtAlgorithm): void {
    crdtAlgorithms.set(algorithm.id, algorithm);
}

export function getCrdtAlgorithm(id: string): CrdtAlgorithm {
    const algo = crdtAlgorithms.get(id);

    if (algo === undefined) {
        throw new Error(`Crdt algorithm with id '${id}' does not exist.`);
    }

    return algo;
}

export function getDefaultCrdtAlgorithm(type: CrdtTypes): CrdtAlgorithm {
    return getCrdtAlgorithm(getDefaultCrdtAlgorithmId(type));
}

// #### Algorithm configuration management (part of recipes) ####

export function getCrdtAlgorithmFromConfigOrDefault(
    crdtConfig: Map<string, string>,
    path: string,
    type: CrdtTypes
): CrdtAlgorithm {
    return getCrdtAlgorithm(getCrdtAlgorithmIdFromConfigOrDefault(crdtConfig, path, type));
}

export function getCrdtAlgorithmIdFromConfigOrDefault(
    crdtConfig: Map<string, string>,
    path: string,
    type: CrdtTypes
): string {
    // Check for algorithm for exact path and a specific type
    let algoId = crdtConfig.get(`${path}#${type}`);

    if (algoId !== undefined) {
        return algoId;
    }

    // Check for algorithm for exact path
    algoId = crdtConfig.get(path);

    if (algoId !== undefined) {
        return algoId;
    }

    // Find paths with placeholders
    const pathElems = path.split('.');

    let maxMatchingKey: string = '';
    let maxMatchingPrio: number = 0;

    for (const keyPath of crdtConfig.keys()) {
        const keyPathElems = keyPath.split('.');

        // Path does not match if the size is different
        if (keyPathElems.length !== pathElems.length) {
            continue;
        }

        // Compare all elements
        for (let i = 0; i < keyPathElems.length; ++i) {
            // Last level needs special check
            if (i === keyPathElems.length - 1) {
                let currPrio = 0;

                if (keyPathElems[i] === `${pathElems[i]}#${type}`) {
                    currPrio = 4;
                } else if (keyPathElems[i] === `*#${type}`) {
                    currPrio = 3;
                } else if (keyPathElems[i] === pathElems[i]) {
                    currPrio = 2;
                } else if (keyPathElems[i] === '*') {
                    currPrio = 1;
                }

                if (maxMatchingPrio < currPrio) {
                    maxMatchingPrio = currPrio;
                    maxMatchingKey = keyPath;
                }
            } else if (keyPathElems[i] === '*' || keyPathElems[i] === pathElems[i]) {
                // Test of this level matched - continue to next level
                continue;
            }

            break;
        }
    }

    if (maxMatchingPrio > 0) {
        algoId = crdtConfig.get(maxMatchingKey);

        if (algoId !== undefined) {
            return algoId;
        }
    }

    return getDefaultCrdtAlgorithmId(type);
}
