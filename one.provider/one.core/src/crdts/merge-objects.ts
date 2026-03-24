import type {OneVersionedObjectInterfaces} from '@OneObjectInterfaces';
import {isOptionalValueCrdtAlgorithm} from './interfaces/CrdtAlgorithmOptionalValue.js';
import type {OptionalValueMergeResult} from './interfaces/CrdtAlgorithmOptionalValue.js';
import {isReferenceToObjectCrdtAlgorithm} from './interfaces/CrdtAlgorithmReferenceToObject.js';
import type {ReferenceToObjectMergeResult} from './interfaces/CrdtAlgorithmReferenceToObject.js';
import {isStandardCrdtAlgorithm, type OneDataTypes} from './interfaces/CrdtAlgorithmStandard.js';
import {createMessageBus} from '../message-bus.js';
import type {OneVersionedObjectTypeNames, VersionNode} from '../recipes.js';
import type {VersionedObjectResult} from '../storage-versioned-objects.js';
import type {CbArgs} from '../util/iterate-objects-merge.js';
import {iterateObjectsMerge} from '../util/iterate-objects-merge.js';
import {calculateIdHashOfObj} from '../util/object.js';
import type {SHA256Hash, SHA256IdHash} from '../util/type-checks.js';
import {VersionTree} from './VersionTree.js';

const MessageBus = createMessageBus('mergeObjects');

export async function mergeObjects<T extends OneVersionedObjectTypeNames>(
    firstNodeHash: SHA256Hash<VersionNode<OneVersionedObjectInterfaces[T]>>,
    secondNodeHash: SHA256Hash<VersionNode<OneVersionedObjectInterfaces[T]>>,
    type: T
): Promise<
    | {
          alreadyMerged: false;
          result: VersionedObjectResult<OneVersionedObjectInterfaces[T]> & {timestamp: number};
          tree: VersionTree;
      }
    | {
          alreadyMerged: true;
          result: VersionedObjectResult<OneVersionedObjectInterfaces[T]> & {timestamp: undefined};
          newNodeHash: SHA256Hash<VersionNode<OneVersionedObjectInterfaces[T]>>;
          tree: VersionTree;
      }
> {
    MessageBus.send(
        'log',
        `merge version nodes ${firstNodeHash} and ${secondNodeHash} of type ${type}`
    );

    const tree = await VersionTree.constructVersionTreeUntilCommonHistory(
        firstNodeHash,
        secondNodeHash
    );

    if (tree.firstMergeNode.hash === tree.secondMergeNode.hash) {
        const obj = tree.firstMergeNode.data as OneVersionedObjectInterfaces[T];
        const hash = tree.firstMergeNode.obj.data as SHA256Hash<OneVersionedObjectInterfaces[T]>;
        const idHash = (await calculateIdHashOfObj(obj)) as SHA256IdHash<
            OneVersionedObjectInterfaces[T]
        >;
        
        return {
            alreadyMerged: true,
            result: {
                obj,
                hash,
                idHash,
                status: 'exists',
                timestamp: undefined
            },
            newNodeHash: tree.firstMergeNode.hash as SHA256Hash<VersionNode<OneVersionedObjectInterfaces[T]>>,
            tree
        };
    }

    const result = await iterateObjectsMerge(type, tree, {
        string: standardMerge,
        integer: standardMerge,
        number: standardMerge,
        boolean: standardMerge,
        async referenceToObj(args): Promise<ReferenceToObjectMergeResult> {
            MessageBus.send(
                'debug',
                `merge ${args.path} [referenceToObj] with algorithm ${args.crdtAlgorithm.id}`
            );

            if (isReferenceToObjectCrdtAlgorithm(args.crdtAlgorithm)) {
                return args.crdtAlgorithm.merge(args.tree);
            } else if (isStandardCrdtAlgorithm<SHA256Hash>(args.crdtAlgorithm)) {
                return {
                    action: 'set',
                    value: await args.crdtAlgorithm.merge(args.tree, args.valueType)
                };
            } else {
                throw new Error(
                    `Algorithm ${args.crdtAlgorithm.id} is of incorrect type. Expected "ReferenceToObject" ot "Standard" type, found ${args.crdtAlgorithm.algoType}`
                );
            }
        },
        referenceToId: standardMerge,
        referenceToClob: standardMerge,
        referenceToBlob: standardMerge,
        map: standardMerge,
        mapEntry: optionalValueMerge,
        bag: standardMerge,
        array: standardMerge,
        set: standardMerge,
        object: standardMerge,
        objectProperty: optionalValueMerge,
        stringifiable: standardMerge
    });

    MessageBus.send(
        'log',
        `merge version nodes ${firstNodeHash} and ${secondNodeHash} of type ${type} done`
    );

    return {
        alreadyMerged: false,
        result,
        tree
    };
}

async function standardMerge<T extends OneDataTypes>(args: CbArgs<T>): Promise<T> {
    MessageBus.send(
        'debug',
        `merge ${args.path} [${args.valueType.type}] with algorithm ${args.crdtAlgorithm.id}`
    );

    if (!isStandardCrdtAlgorithm<T>(args.crdtAlgorithm)) {
        throw new Error(
            `Algorithm ${args.crdtAlgorithm.id} is of incorrect type. Expected "Standard" type, found ${args.crdtAlgorithm.algoType}`
        );
    }

    return args.crdtAlgorithm.merge(args.tree, args.valueType);
}

async function optionalValueMerge(args: CbArgs<unknown>): Promise<OptionalValueMergeResult> {
    MessageBus.send(
        'debug',
        `merge ${args.path} [${args.valueType.type}] with algorithm ${args.crdtAlgorithm.id}`
    );

    if (!isOptionalValueCrdtAlgorithm(args.crdtAlgorithm)) {
        throw new Error(
            `Algorithm ${args.crdtAlgorithm.id} is of incorrect type. Expected "OptionalValue" type, found ${args.crdtAlgorithm.algoType}`
        );
    }

    return args.crdtAlgorithm.merge(args.tree);
}
