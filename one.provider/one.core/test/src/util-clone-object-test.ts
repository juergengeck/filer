import {expect} from 'chai';

import {clone} from '../../lib/util/clone-object.js';
import type {AnyObject} from '../../lib/util/object.js';

import {errObjConverter} from './_helpers.js';

const sparseArray = [];
sparseArray[5] = 10;

const original = {
    num: 42,
    str: 'foobar',
    bool: true,
    date: new Date('Sat Feb 14 2009 00:31:30 GMT+0100'),
    arr: [1, 2, 3, 4, 5],
    map: new Map([
        ['key1', 'value1'],
        ['key2', 'value2']
    ]),
    set: new Set(['value1', 'value2']),
    regex: /^[123]*.*$/gi,
    specialVals: {
        a: NaN,
        b: Infinity,
        c: undefined,
        d: sparseArray
    },
    obj: {
        cycle: {} as any,
        innerCycle: {} as any,
        arr: ['g', 'foo', 'bar']
    }
};

original.obj.cycle = original;
original.obj.innerCycle = original.obj;

// Overwrite the storage method so that the test does not actually store anything.
describe('Object deep clone tests', () => {
    it('Should not equal the original object but its contents', () => {
        const c = clone(original);

        // References are different, contents is the same
        expect(c).to.not.equal(original);
        expect(c.obj).to.not.equal(original.obj);
        expect(c.regex).to.not.equal(original.regex);
        expect(c.obj.arr).to.not.equal(original.obj.arr);
        expect(c.obj.arr[0]).to.equal(original.obj.arr[0]);
        expect(c).to.deep.equal(original);
    });

    it('Should have the same cycles as the original object', () => {
        const c = clone(original);

        expect(c.obj.cycle).to.not.equal(original);
        expect(c.obj.cycle).to.equal(c);
        expect(c.obj.cycle.num).to.equal(42);

        expect(c.obj.innerCycle).to.not.equal(original.obj);
        expect(c.obj.innerCycle.arr).to.deep.equal(['g', 'foo', 'bar']);
        (c.obj.innerCycle.arr as any[]).push(42);
        expect(c.obj.innerCycle.arr).to.deep.equal(['g', 'foo', 'bar', 42]);
        expect(original.obj.innerCycle.arr).to.deep.equal(['g', 'foo', 'bar']);
    });

    it('Should have same date as the original object but it is a different Date object', () => {
        const c = clone(original);

        expect(c.date.toUTCString()).to.equal(original.date.toUTCString());
        expect(c.date).to.not.equal(original.date);
    });

    it('Should have same RegExp as the original object but it is a different RegExp object', () => {
        const c = clone(original);

        expect(c.regex.toString()).to.equal(original.regex.toString());
        expect(c.regex).to.not.equal(original.regex);
    });

    it('Should not show changes in the original object', () => {
        const c = clone(original);

        c.num = 1;
        c.arr.push(42);
        (c.obj as AnyObject).newProp = 'string';

        expect(original.num).to.equal(42);
        expect(original.arr).to.deep.equal([1, 2, 3, 4, 5]);
        expect((original.obj as AnyObject).newProp).to.be.undefined;
    });

    it('Should clone Error objects', () => {
        const err0: any = new Error('Foo error');

        err0.code = 1000;

        const c0 = clone({prop: err0});

        expect(c0.prop instanceof Error).to.be.true;
        expect({
            prop: errObjConverter(c0.prop)
        }).to.deep.equal({
            prop: errObjConverter(err0)
        });

        const err1 = new TypeError('Foo type error');
        const c1 = clone(err1);
        expect(c1 instanceof TypeError).to.be.true;
        expect(errObjConverter(c1)).to.deep.equal(errObjConverter(err1));

        const err2: any = new EvalError('Foo type error');
        err2.fileName = 'file';
        err2.code = 123;
        err2.extraProp = new Date(123456);

        const c2 = clone(err2);
        expect(c2 instanceof EvalError).to.be.true;
        expect(errObjConverter(c2)).to.deep.equal(errObjConverter(err2));
    });
});
