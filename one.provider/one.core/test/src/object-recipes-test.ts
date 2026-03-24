import {expect} from 'chai';

import {convertMicrodataToObject} from '../../lib/microdata-to-object.js';
import {addCoreRecipesToRuntime, clearRuntimeRecipes} from '../../lib/object-recipes.js';
import {convertObjToMicrodata} from '../../lib/object-to-microdata.js';
import {CORE_RECIPES} from '../../lib/recipes.js';
import {ensureRecipeObj} from '../../lib/util/recipe-checks.js';
import {stringify} from '../../lib/util/sorted-stringify.js';

import {RECIPES} from './_register-types.js';

describe('Object Recipes tests', () => {
    before(addCoreRecipesToRuntime);
    after(clearRuntimeRecipes);
    it('should type-check the core recipes', () => {
        for (const recipe of CORE_RECIPES) {
            // Throws an error if the recipe has a problem
            ensureRecipeObj(recipe);
        }

        expect(true).to.be.true;
    });

    it('should type-check the test recipes', () => {
        for (const recipe of RECIPES) {
            // Throws an error if the recipe has a problem
            ensureRecipeObj(recipe);
        }

        expect(true).to.be.true;
    });

    it('should convert the core recipes to microdata and back', () => {
        for (const recipe of CORE_RECIPES) {
            const microdata = convertObjToMicrodata(recipe);
            const obj = convertMicrodataToObject(microdata);
            expect(stringify(obj)).to.equal(stringify(recipe));
        }
    });

    it('should convert the test recipes to microdata and back', () => {
        for (const recipe of RECIPES) {
            const microdata = convertObjToMicrodata(recipe);
            const obj = convertMicrodataToObject(microdata);
            expect(ensureRecipeObj(obj)).to.deep.equal(recipe);
        }
    });
});
