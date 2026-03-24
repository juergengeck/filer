/* eslint-disable no-console */
import {expect} from 'chai';
/**
 * These CRDT tests are intended to test the synchronous use cases.
 * e.g. Some UI client fetches a CRDT object from the db and the performs multiple update calls.
 * @file
 */
import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import {storeUnversionedObject} from '../../lib/storage-unversioned-objects.js';
import {
    getCurrentVersionNode,
    storeVersionedObject,
    STORE_AS
} from '../../lib/storage-versioned-objects.js';
import type {SHA256Hash, SHA256IdHash} from '../../lib/util/type-checks.js';
import type {OneVersionedObjectTypes, Recipe} from '../../lib/recipes.js';
import {getChild, VersionTree} from '../../lib/crdts/VersionTree.js';

import * as StorageTestInit from './_helpers.js';

// -------------------- Types & Recipes --------------------
declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        OneSyncTest$OptionalUnversionedLvl1: OneSyncTest$OptionalUnversionedLvl1;
        OneSyncTest$OptionalUnversionedLvl2: OneSyncTest$OptionalUnversionedLvl2;
    }

    export interface OneVersionedObjectInterfaces {
        Test$Optional: Test$Optional;
        Test$Map: Test$Map;
        Test$Bag: Test$Bag;
        OneSyncTest$CRDTOptional: OneSyncTest$CRDTOptional;
    }

    export interface OneIdObjectInterfaces {
        Test$Optional: Pick<Test$Optional, '$type$' | 'id'>;
        Test$Map: Pick<Test$Map, '$type$' | 'id'>;
        Test$Bag: Pick<Test$Bag, '$type$' | 'id'>;
        OneSyncTest$CRDTOptional: Pick<OneSyncTest$CRDTOptional, '$type$' | 'id'>;
    }
}

interface Test$Optional {
    $type$: 'Test$Optional';
    id: string;
    value?: string;
    x?: Set<{a: string}>;
}

interface Test$Map {
    $type$: 'Test$Map';
    id: string;
    x: Map<string, string>;
}

interface Test$Bag {
    $type$: 'Test$Bag';
    id: string;
    x: [];
}

interface OneSyncTest$CRDTOptional {
    $type$: 'OneSyncTest$CRDTOptional';
    id: string;
    unversionedOptionalLvl1?: SHA256Hash<OneSyncTest$OptionalUnversionedLvl1>;
}

interface OneSyncTest$OptionalUnversionedLvl1 {
    $type$: 'OneSyncTest$OptionalUnversionedLvl1';
    listNumApp: number[];
    unversionedOptionalLvl2: SHA256Hash<OneSyncTest$OptionalUnversionedLvl2>;
}

interface OneSyncTest$OptionalUnversionedLvl2 {
    $type$: 'OneSyncTest$OptionalUnversionedLvl2';
    listNumApp: number[];
}

const Test$OptionalRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Test$Optional',
    rule: [
        {
            itemprop: 'id',
            isId: true
        },
        {
            itemprop: 'value',
            optional: true
        },
        {
            itemprop: 'x',
            itemtype: {
                type: 'set',
                item: {
                    type: 'object',
                    rules: [
                        {
                            itemprop: 'a'
                        }
                    ]
                }
            },
            optional: true
        }
    ]
};

const Test$MapRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Test$Map',
    rule: [
        {
            itemprop: 'id',
            isId: true
        },
        {
            itemprop: 'x',
            itemtype: {
                type: 'map',
                key: {
                    type: 'string'
                },
                value: {
                    type: 'string'
                }
            }
        }
    ]
};

const Test$BagRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Test$Bag',
    rule: [
        {
            itemprop: 'id',
            isId: true
        },
        {
            itemprop: 'x',
            itemtype: {
                type: 'bag',
                item: {
                    type: 'string'
                }
            }
        }
    ]
};

const OneSyncTest$CRDTOptionalRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'OneSyncTest$CRDTOptional',
    crdtConfig: new Map(),
    rule: [
        {
            itemprop: 'id',
            itemtype: {type: 'string'},
            isId: true
        },
        {
            itemprop: 'unversionedOptionalLvl1',
            itemtype: {
                type: 'referenceToObj',
                allowedTypes: new Set(['OneSyncTest$OptionalUnversionedLvl1'])
            },
            optional: true
        }
    ]
};

const OneSyncTest$OptionalUnversionedLvl1Recipe: Recipe = {
    $type$: 'Recipe',
    name: 'OneSyncTest$OptionalUnversionedLvl1',
    rule: [
        {
            itemprop: 'unversionedOptionalLvl2',
            itemtype: {
                type: 'referenceToObj',
                allowedTypes: new Set(['OneSyncTest$OptionalUnversionedLvl2'])
            }
        },
        {
            itemprop: 'listNumApp',
            itemtype: {type: 'bag', item: {type: 'number'}}
        }
    ]
};

const OneSyncTest$OptionalUnversionedLvl2Recipe: Recipe = {
    $type$: 'Recipe',
    name: 'OneSyncTest$OptionalUnversionedLvl2',
    rule: [
        {
            itemprop: 'listNumApp',
            itemtype: {type: 'bag', item: {type: 'number'}}
        }
    ]
};

const CRDT_TEST_RECIPES: Recipe[] = [
    Test$OptionalRecipe,
    Test$MapRecipe,
    Test$BagRecipe,
    OneSyncTest$CRDTOptionalRecipe,
    OneSyncTest$OptionalUnversionedLvl1Recipe,
    OneSyncTest$OptionalUnversionedLvl2Recipe
];

export type MapKeyType<M extends Map<any, any>> = M extends Map<infer K, any> ? K : never;
export type MapValueType<M extends Map<any, any>> = M extends Map<any, infer V> ? V : never;

export function getOrCreate<M extends Map<any, any>>(
    map: M,
    k: MapKeyType<M>,
    v: MapValueType<M> | (() => MapValueType<M>)
): MapValueType<M> {
    const value = map.get(k);

    if (value === undefined) {
        const newValue = typeof v === 'function' ? (v as () => MapValueType<M>)() : v;
        map.set(k, newValue);
        return newValue;
    } else {
        return value;
    }
}

async function dumpTree(idHash: SHA256IdHash<OneVersionedObjectTypes>): Promise<void> {
    const currentVersionNode = await getCurrentVersionNode(idHash);
    const tree = await VersionTree.constructCompleteVersionTree(currentVersionNode.hash);

    console.log('');
    console.log(tree.getStringRepresentation());
    console.log(currentVersionNode);
}

describe('Versioned object test suite', () => {
    before(async () => {
        await StorageTestInit.init({initialRecipes: CRDT_TEST_RECIPES});
    });

    after(closeAndDeleteCurrentInstance);

    it('Versions auto merge test for optional value', async () => {
        const o1 = await storeVersionedObject({
            $type$: 'Test$Optional',
            id: 'id',
            value: 'o1',
            x: new Set([{a: 'hello1'}, {a: 'hello2'}, {a: 'hello3'}])
        });

        // await dumpTree(o1.idHash);

        expect(o1.obj.x).not.to.be.undefined;
        if(o1.obj.x === undefined) {
            throw new Error('o1.obj.x is undefined');
        }
        expect([...o1.obj.x]).to.be.eql([{a: 'hello1'}, {a: 'hello2'}, {a: 'hello3'}]);

        const o2 = await storeVersionedObject({
            $type$: 'Test$Optional',
            id: 'id',
            value: 'o2',
            x: new Set([{a: 'hello1'}, {a: 'hello2'}, {a: 'hello4'}])
        }, STORE_AS.MERGE);

        // await dumpTree(o1.idHash);

        expect(o2.obj.x).not.to.be.undefined;
        if(o2.obj.x === undefined) {
            throw new Error('o2.obj.x is undefined');
        }
        expect([...o2.obj.x]).to.be.eql([
            {a: 'hello1'},
            {a: 'hello2'},
            {a: 'hello3'},
            {a: 'hello4'}
        ]);

        const o3 = await storeVersionedObject({
            $type$: 'Test$Optional',
            id: 'id',
            value: 'o3'
        });

        // await dumpTree(o1.idHash);
        expect(o3.obj.x).to.be.undefined;

        const o4 = await storeVersionedObject({
            $type$: 'Test$Optional',
            id: 'id',
            value: 'o4',
            x: new Set([{a: 'x1'}, {a: 'x2'}, {a: 'x3'}])
        });

        // await dumpTree(o1.idHash);

        expect(o4.obj.x).not.to.be.undefined;
        if(o4.obj.x === undefined) {
            throw new Error('o4.obj.x is undefined');
        }
        expect([...o4.obj.x]).to.be.eql([{a: 'x1'}, {a: 'x2'}, {a: 'x3'}]);

        const o5 = await storeVersionedObject({
            $type$: 'Test$Optional',
            id: 'id',
            value: 'o5',
            x: new Set([{a: 'x1'}, {a: 'x2'}, {a: 'x4'}])
        }, STORE_AS.MERGE);

        // await dumpTree(o1.idHash);

        expect(o5.obj.x).not.to.be.undefined;
        if(o5.obj.x === undefined) {
            throw new Error('o5.obj.x is undefined');
        }
        expect([...o5.obj.x]).to.be.eql([{a: 'x1'}, {a: 'x2'}, {a: 'x3'}, {a: 'x4'}]);
    });

    it.skip('Get Child Test', async () => {
        const o1_l2 = await storeUnversionedObject({
            $type$: 'OneSyncTest$OptionalUnversionedLvl2',
            listNumApp: [1, 2]
        });

        const o1_l1 = await storeUnversionedObject({
            $type$: 'OneSyncTest$OptionalUnversionedLvl1',
            unversionedOptionalLvl2: o1_l2.hash,
            listNumApp: [1, 2]
        });

        const o1_v = await storeVersionedObject({
            $type$: 'OneSyncTest$CRDTOptional',
            id: '2',
            unversionedOptionalLvl1: o1_l1.hash
        });

        const o1_vh = await storeVersionedObject(o1_v.obj);

        console.log(o1_vh);

        console.log('CHILD', await getChild(o1_v.obj, 'unversionedOptionalLvl1', true));
    });

    it.skip('Person test', async () => {
        const r1 = await storeVersionedObject({
            $type$: 'Person',
            email: 'e@e',
            name: 'Erik H'
        });

        await dumpTree(r1.idHash);

        await storeVersionedObject({
            $type$: 'Person',
            email: 'e@e',
            name: 'Erik Hohoho'
        });
        await dumpTree(r1.idHash);

        await storeVersionedObject({
            $type$: 'Person',
            email: 'e@e',
            name: 'Erik Zhou'
        });

        await dumpTree(r1.idHash);

        const r2 = await storeVersionedObject({
            $type$: 'Person',
            email: 'e@e',
            name: 'Erik H'
        });

        await dumpTree(r1.idHash);

        await storeVersionedObject({
            $type$: 'Person',
            email: 'e@e',
            name: 'Erik Hohoho'
        });
        await dumpTree(r1.idHash);

        await storeVersionedObject({
            $type$: 'Person',
            email: 'e@e',
            name: 'Erik Zhou'
        });
        await dumpTree(r1.idHash);
    });

    it.skip('Map test', async () => {
        const r0 = await storeVersionedObject({
            $type$: 'Test$Map',
            id: '1',
            x: new Map()
        });

        await dumpTree(r0.idHash);

        const r1 = await storeVersionedObject({
            $type$: 'Test$Map',
            id: '1',
            x: new Map([['a', '1']])
        });

        await dumpTree(r1.idHash);

        console.log(r1.obj);
        r1.obj.x.set('a', '2');

        const r2 = await storeVersionedObject(r1.obj);
        await dumpTree(r2.idHash);
        r2.obj.x.delete('a');

        const r3 = await storeVersionedObject(r1.obj);
        await dumpTree(r3.idHash);
    });

    it.skip('Bag test', async () => {
        const r0 = await storeVersionedObject({
            $type$: 'Test$Bag',
            id: '1',
            x: []
        });

        await dumpTree(r0.idHash);

        const r1 = await storeVersionedObject({
            $type$: 'Test$Bag',
            id: '1',
            x: []
        });

        await dumpTree(r1.idHash);
        console.log(r1.obj);
    });
});
