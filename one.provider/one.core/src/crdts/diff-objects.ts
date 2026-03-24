import {isOptionalValueCrdtAlgorithm} from './interfaces/CrdtAlgorithmOptionalValue.js';
import {isReferenceToObjectCrdtAlgorithm} from './interfaces/CrdtAlgorithmReferenceToObject.js';
import {isStandardCrdtAlgorithm} from './interfaces/CrdtAlgorithmStandard.js';
import type {OneDataTypes} from './interfaces/CrdtAlgorithmStandard.js';
import type {Transformation} from './interfaces/Transformation.js';
import {createMessageBus} from '../message-bus.js';
import type {OneObjectTypes} from '../recipes.js';
import {makeSparseArray, sparseMap} from '../util/array.js';
import type {CbArgs, IterationStrategy} from '../util/iterate-objects.js';
import {iterateObjects} from '../util/iterate-objects.js';
import type {SHA256Hash, SHA256IdHash} from '../util/type-checks.js';

const MessageBus = createMessageBus('diffObjects');

/**
 * Calculates the difference of two objects expressed as transofrmations of children.
 *
 * @param {T} obj1
 * @param {T} obj2
 * @returns {Promise<Map<string, Transformation[]>>}
 */
export async function diffObjects<T extends OneObjectTypes>(
    obj1: T | null,
    obj2: T
): Promise<Map<string, Transformation[]>> {
    const diffMap = new Map<string, Transformation[]>();

    MessageBus.send(
        'log',
        `diff objects of type ${obj2.$type$}${obj1 === null ? '. obj1 is null.' : ''}`
    );

    function appendDiff(k: string, v: Transformation[]): void {
        if (v.length === 0) {
            return;
        }

        const value = diffMap.get(k);

        if (value === undefined) {
            diffMap.set(k, [...v]);
        } else {
            value.push(...v);
        }
    }

    async function standardDiff<A extends OneDataTypes>(args: CbArgs<A>): Promise<void> {
        MessageBus.send(
            'debug',
            `diff ${args.path} [${args.valueType.type}] with algorithm ${args.crdtAlgorithm.id}`
        );

        if (!isStandardCrdtAlgorithm<A>(args.crdtAlgorithm)) {
            throw new Error(
                `Algorithm ${args.crdtAlgorithm.id} is of incorrect type. Expected "Standard" type, found ${args.crdtAlgorithm.algoType}`
            );
        }

        appendDiff(
            args.path.concat('#', args.crdtAlgorithm.id),
            0 in args.values
                ? await args.crdtAlgorithm.diff(args.values[0], args.values[1], args.valueType)
                : await args.crdtAlgorithm.initialDiff(args.values[1], args.valueType)
        );
    }

    async function optionalValueDiff(
        args: CbArgs<unknown> & {optional?: boolean}
    ): Promise<IterationStrategy> {
        // Optional is only set for objectProperties, mapEntries are always optional
        const optional = args.optional === undefined ? true : args.optional;

        MessageBus.send(
            'debug',
            `diff ${args.path} [${args.valueType.type}] with algorithm ${args.crdtAlgorithm.id}`
        );

        if (!isOptionalValueCrdtAlgorithm(args.crdtAlgorithm)) {
            throw new Error(
                `Algorithm ${args.crdtAlgorithm.id} is of incorrect type. Expected "OptionalValue" type, found ${args.crdtAlgorithm.algoType}`
            );
        }

        if (optional) {
            appendDiff(
                args.path.concat('#', args.crdtAlgorithm.id),
                0 in args.values
                    ? await args.crdtAlgorithm.diff(args.values[0], args.values[1])
                    : await args.crdtAlgorithm.initialDiff(args.values[1])
            );

            if (args.values[1] === undefined) {
                return 'off';
            } else {
                return 'parallel';
            }
        } else {
            return 'parallel';
        }
    }

    await iterateObjects(
        obj1 === null ? makeSparseArray([[1, obj2]]) : [obj1, obj2],
        {
            string: standardDiff,
            integer: standardDiff,
            number: standardDiff,
            boolean: standardDiff,
            async referenceToObj(args): Promise<IterationStrategy> {
                MessageBus.send(
                    'debug',
                    `diff ${args.path} [referenceToObj] with algorithm ${args.crdtAlgorithm.id}`
                );

                if (isReferenceToObjectCrdtAlgorithm(args.crdtAlgorithm)) {
                    if (args.objs === undefined) {
                        throw new Error('Objs is undefined');
                    }

                    const o = args.objs;
                    const values = sparseMap(args.values, (hash, i) => ({hash, obj: o[i]}));

                    appendDiff(
                        args.path.concat('#', args.crdtAlgorithm.id),
                        0 in values
                            ? await args.crdtAlgorithm.diff(values[0], values[1])
                            : await args.crdtAlgorithm.initialDiff(values[1])
                    );

                    return 'parallel';
                } else if (isStandardCrdtAlgorithm<SHA256Hash | SHA256IdHash>(args.crdtAlgorithm)) {
                    appendDiff(
                        args.path.concat('#', args.crdtAlgorithm.id),
                        0 in args.values
                            ? await args.crdtAlgorithm.diff(
                                  args.values[0],
                                  args.values[1],
                                  args.valueType
                              )
                            : await args.crdtAlgorithm.initialDiff(args.values[1], args.valueType)
                    );

                    return 'off';
                } else {
                    throw new Error(
                        `Algorithm ${args.crdtAlgorithm.id} is of incorrect type. Expected "ReferenceToObject" ot "Standard" type, found ${args.crdtAlgorithm.algoType}`
                    );
                }
            },
            referenceToId: standardDiff,
            referenceToClob: standardDiff,
            referenceToBlob: standardDiff,
            mapEntry: optionalValueDiff,
            bag: standardDiff,
            array: standardDiff,
            set: standardDiff,
            objectProperty: optionalValueDiff,
            stringifiable: standardDiff
        },
        {
            iterateChildObjects: true,
            iterateChildIdObjects: false,
            defaultIterationStrategies: {
                bagValues: 'off',
                arrayValues: 'off',
                setValues: 'off'
            }
        }
    );

    MessageBus.send('log', `diff objects of type ${obj2.$type$} done`, [...diffMap]);

    return diffMap;
}
