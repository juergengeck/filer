import {expect} from 'chai';
import type {RecipeRule} from '@refinio/one.core/lib/recipes.js';
import {
    addRule,
    cloneRule,
    getRule,
    hasRule,
    overwriteRule,
    removeRule
} from '../lib/recipes/RecipeUtils.js';

/**
 * Test for testing the rule helpers
 */
describe('RulesTest', () => {
    it('cloneRule', function () {
        const orig: RecipeRule[] = [
            {itemprop: 'one1'},
            {itemprop: 'two1'},
            {
                itemprop: 'three1',
                itemtype: {
                    type: 'object',
                    rules: [
                        {itemprop: 'one2'},
                        {
                            itemprop: 'two2',
                            itemtype: {
                                type: 'object',
                                rules: [{itemprop: 'one3'}, {itemprop: 'two3'}]
                            }
                        },

                        {itemprop: 'three2'},
                        {itemprop: 'four2'}
                    ]
                }
            },
            {itemprop: 'four1'}
        ];

        const copy = orig;
        expect(getRule(orig, 'one1')).to.be.equal(getRule(copy, 'one1'));
        expect(getRule(orig, 'two1')).to.be.equal(getRule(copy, 'two1'));
        expect(getRule(orig, 'three1')).to.be.equal(getRule(copy, 'three1'));
        expect(getRule(orig, 'three1.one2')).to.be.equal(getRule(copy, 'three1.one2'));
        expect(getRule(orig, 'three1.two2')).to.be.equal(getRule(copy, 'three1.two2'));
        expect(getRule(orig, 'three1.two2.one3')).to.be.equal(getRule(copy, 'three1.two2.one3'));
        expect(getRule(orig, 'three1.two2.two3')).to.be.equal(getRule(copy, 'three1.two2.two3'));
        expect(getRule(orig, 'three1.three2')).to.be.equal(getRule(copy, 'three1.three2'));
        expect(getRule(orig, 'three1.four2')).to.be.equal(getRule(copy, 'three1.four2'));
        expect(getRule(orig, 'four1')).to.be.equal(getRule(copy, 'four1'));

        const clone = cloneRule(orig);
        expect(getRule(orig, 'one1')).not.to.be.equal(getRule(clone, 'one1'));
        expect(getRule(orig, 'two1')).not.to.be.equal(getRule(clone, 'two1'));
        expect(getRule(orig, 'three1')).not.to.be.equal(getRule(clone, 'three1'));
        expect(getRule(orig, 'three1.one2')).not.to.be.equal(getRule(clone, 'three1.one2'));
        expect(getRule(orig, 'three1.two2')).not.to.be.equal(getRule(clone, 'three1.two2'));
        expect(getRule(orig, 'three1.two2.one3')).not.to.be.equal(
            getRule(clone, 'three1.two2.one3')
        );
        expect(getRule(orig, 'three1.two2.two3')).not.to.be.equal(
            getRule(clone, 'three1.two2.two3')
        );
        expect(getRule(orig, 'three1.three2')).not.to.be.equal(getRule(clone, 'three1.three2'));
        expect(getRule(orig, 'three1.four2')).not.to.be.equal(getRule(clone, 'three1.four2'));
        expect(getRule(orig, 'four1')).not.to.be.equal(getRule(clone, 'four1'));
    });

    it('hasRule', function () {
        const orig: RecipeRule[] = [
            {itemprop: 'one1'},
            {itemprop: 'two1'},
            {
                itemprop: 'three1',
                itemtype: {
                    type: 'object',
                    rules: [
                        {itemprop: 'one2'},
                        {
                            itemprop: 'two2',
                            itemtype: {
                                type: 'object',
                                rules: [{itemprop: 'one3'}, {itemprop: 'two3'}]
                            }
                        },

                        {itemprop: 'three2'},
                        {itemprop: 'four2'}
                    ]
                }
            },
            {itemprop: 'four1'}
        ];

        expect(hasRule(orig, 'one1')).to.be.true;
        expect(hasRule(orig, 'two1')).to.be.true;
        expect(hasRule(orig, 'three1')).to.be.true;
        expect(hasRule(orig, 'three1.one2')).to.be.true;
        expect(hasRule(orig, 'three1.two2')).to.be.true;
        expect(hasRule(orig, 'three1.two2.one3')).to.be.true;
        expect(hasRule(orig, 'three1.two2.two3')).to.be.true;
        expect(hasRule(orig, 'three1.three2')).to.be.true;
        expect(hasRule(orig, 'three1.four2')).to.be.true;
        expect(hasRule(orig, 'four1')).to.be.true;
        expect(hasRule(orig, 'nothing')).to.be.false;
        expect(hasRule(orig, 'three1.nothing')).to.be.false;
        expect(hasRule(orig, 'three1.two2.nothing')).to.be.false;
    });

    it('addRemoveRule', function () {
        const rules: RecipeRule[] = [
            {itemprop: 'one1'},
            {itemprop: 'two1'},
            {
                itemprop: 'three1',
                itemtype: {
                    type: 'object',
                    rules: [
                        {itemprop: 'one2'},
                        {
                            itemprop: 'two2',
                            itemtype: {
                                type: 'object',
                                rules: [{itemprop: 'one3'}, {itemprop: 'two3'}]
                            }
                        },

                        {itemprop: 'three2'},
                        {itemprop: 'four2'}
                    ]
                }
            },
            {itemprop: 'four1'}
        ];

        // Add
        addRule(rules, '', {
            itemprop: 'five1'
        });
        addRule(rules, 'three1.two2', {
            itemprop: 'three3'
        });
        expect(hasRule(rules, 'five1')).to.be.true;
        expect(hasRule(rules, 'three1.two2.three3')).to.be.true;

        // Add - fail
        expect(() =>
            addRule(rules, 'three1.two2', {
                itemprop: 'one3',
                optional: true
            })
        ).to.throw;

        // Remove
        removeRule(rules, 'four1');
        expect(hasRule(rules, 'four1')).to.be.false;

        // Remove - fail
        expect(() => removeRule(rules, 'three1.two2.nothing')).to.throw;

        // Overwrite
        overwriteRule(rules, 'three1.two2', {
            itemprop: 'three3',
            optional: true
        });
        expect(getRule(rules, 'three1.two2.three3').optional).to.be.true;

        // Overwrite - fail
        expect(() =>
            overwriteRule(rules, 'three1.two2', {
                itemprop: 'nothing',
                optional: true
            })
        ).to.throw;
    });
});
