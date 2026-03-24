/* eslint-disable no-console */
/**
 * These CRDT tests are intended to test the synchronous use cases.
 * e.g. Some UI client fetches a CRDT object from the db and the performs multiple update calls.
 * @file
 */
import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import {startLogger} from '../../lib/logger.js';
import {diffObjects} from '../../lib/crdts/diff-objects.js';
import type {SHA256Hash} from '../../lib/util/type-checks.js';
import type {Recipe, VersionNode} from '../../lib/recipes.js';

import * as StorageTestInit from './_helpers.js';

startLogger({types: ['error']});

// -------------------- Types & Recipes --------------------
declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {}

    export interface OneVersionedObjectInterfaces {
        TestDiff$Optional: TestDiff$Optional;
    }

    export interface OneIdObjectInterfaces {
        TestDiff$Optional: Pick<TestDiff$Optional, '$type$' | 'id'>;
    }
}

interface TestDiff$Optional {
    $type$: 'TestDiff$Optional';
    id: string;
    value?: {
        x: number;
        y: Set<number>;
    };
}

const TestDiff$OptionalRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'TestDiff$Optional',
    rule: [
        {
            itemprop: 'id',
            isId: true
        },
        {
            itemprop: 'value',
            optional: true,
            itemtype: {
                type: 'object',
                rules: [
                    {
                        itemprop: 'x',
                        itemtype: {
                            type: 'number'
                        }
                    },
                    {
                        itemprop: 'y',
                        itemtype: {
                            type: 'set',
                            item: {
                                type: 'number'
                            }
                        }
                    }
                ]
            }
        }
    ]
};

const CRDT_TEST_RECIPES: Recipe[] = [TestDiff$OptionalRecipe];

describe('Diff object test suite', () => {
    before(async () => {
        await StorageTestInit.init({initialRecipes: CRDT_TEST_RECIPES});
    });

    after(closeAndDeleteCurrentInstance);

    it('Initial test', async () => {
        console.log(
            await diffObjects(
                {
                    $type$: 'TestDiff$Optional',
                    id: '1',
                    value: {
                        x: 10,
                        y: new Set([1, 5, 6])
                    }
                },
                {
                    $type$: 'TestDiff$Optional',
                    id: '1'
                }
            )
        );
    });
});
