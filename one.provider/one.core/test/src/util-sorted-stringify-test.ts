/* eslint-disable require-jsdoc, no-sparse-arrays, quotes */

import {expect} from 'chai';

import type {AnyObject} from '../../lib/util/object.js';
import {stringify, stringifyWithCircles} from '../../lib/util/sorted-stringify.js';

// Overwrite the storage method so that the test does not actually store anything.
describe('Sorted-stringify tests', () => {
    it('Should stringify simple values', () => {
        let json;

        json = stringify('foo');
        expect(json).to.equal('"foo"');
        expect(JSON.parse(json)).to.equal('foo');

        json = stringify(42);
        expect(json).to.equal('42');
        expect(JSON.parse(json)).to.equal(42);

        json = stringify(true);
        expect(json).to.equal('true');
        expect(JSON.parse(json)).to.equal(true);

        json = stringify(null);
        expect(json).to.equal('null');
        expect(JSON.parse(json)).to.equal(null);
    });

    it('Should stringify strings that need escapes', () => {
        let json;

        json = stringify('"Have fun!"');
        expect(json).to.equal('"\\"Have fun!\\""');
        expect(JSON.parse(json)).to.equal('"Have fun!"');

        json = stringify("''");
        expect(json).to.equal('"\'\'"');
        expect(JSON.parse(json)).to.equal("''");

        json = stringify('"$%&/()\\\\\\');
        expect(json).to.equal('"\\"$%&/()\\\\\\\\\\\\"');
        expect(JSON.parse(json)).to.equal('"$%&/()\\\\\\');
    });

    it('Should stringify simple arrays', () => {
        let json;

        const a1: any[] = [];
        json = stringify(a1);
        expect(json).to.equal('[]');
        expect(json).to.equal(JSON.stringify(a1));
        expect(JSON.parse(json)).to.deep.equal([]);

        const a2 = [null, null];
        json = stringify(a2);
        expect(json).to.equal('[null,null]');
        expect(json).to.equal(JSON.stringify(a2));
        expect(JSON.parse(json)).to.deep.equal([null, null]);

        const a3 = ['foo', 11, 2, {}, 42];
        json = stringify(a3);
        expect(json).to.equal('["foo",11,2,{},42]');
        expect(json).to.equal(JSON.stringify(a3));
        expect(JSON.parse(json)).to.deep.equal(['foo', 11, 2, {}, 42]);

        // JSON.stringify(undefined) is undefined, and JSON.stringify([undefined]) is "[null]"
        // noinspection JSConsecutiveCommasInArrayLiteral
        const a4 = [undefined, undefined, , null];
        json = stringify(a4);
        expect(json).to.equal(JSON.stringify(a4));
        expect(JSON.parse(json)).to.deep.equal([null, null, null, null]);
    });

    it('Should stringify strings with newlines correctly', () => {
        const strWithNewlines = `Begin
            more text
            END`;

        expect(stringify(strWithNewlines)).to.equal(JSON.stringify(strWithNewlines));
    });

    it('Should stringify objects', () => {
        let json;

        const o1 = {
            prop: true,
            foo: 'bar',
            other: 42
        };

        json = stringify(o1);
        expect(json).to.equal('{"foo":"bar","other":42,"prop":true}');
        expect(JSON.parse(json)).to.deep.equal(o1);

        const o2 = {
            str: 'foobar',
            bool: true,
            arr: [20, 1, 2, 3, 4, 5],
            num: 42,
            obj: {
                arr: ['g', 'foo', 'bar']
            },
            strWithNewlines: `Begin
            more text
            END`,
            date: new Date('Sat Feb 14 2009 00:31:30 GMT+0100'),
            someData: {
                obj: {
                    xnum: 42,
                    obj: {
                        num: 42,
                        foo: 'bar'
                    }
                },
                aaa: 1
            }
        };

        json = stringify(o2);
        expect(json).to.equal(
            '{' +
                '"arr":[20,1,2,3,4,5],' +
                '"bool":true,' +
                '"date":"2009-02-13T23:31:30.000Z",' +
                '"num":42,' +
                '"obj":{"arr":["g","foo","bar"]},' +
                '"someData":{"aaa":1,"obj":{"obj":{"foo":"bar","num":42},"xnum":42}},' +
                '"str":"foobar",' +
                '"strWithNewlines":"Begin\\n            more text\\n            END"' +
                '}'
        );

        const o = JSON.parse(json, (key, value) => (key === 'date' ? new Date(value) : value));
        expect(o).to.deep.equal(o2);
    });

    it('Should ignore undefined properties', () => {
        const json = stringify({ignoreMe: undefined});
        expect(json).to.equal('{}');
        expect(JSON.parse(json)).to.deep.equal({});
    });

    // NOTE: The function does not have code to check for circular references. We simply let it
    // run into a stack overflow error, why add runtime code for a condition that should halt
    // the program anyway and that also adds no additional debug value?
    it('Should FAIL to stringify objects with circular references', () => {
        const o: AnyObject = {
            foo: 'bar',
            circle: undefined,
            bar: {
                deep: {
                    deepCircle: undefined
                }
            }
        };

        o.circle = o;
        expect(() => stringify(o)).to.throw(
            Error,
            'Object cannot be stringified because it has a circle; property: circle'
        );

        o.circle = new Map([
            [1, o],
            [2, o]
        ]);
        expect(() => stringify(o)).to.throw(
            Error,
            'Object cannot be stringified because it has a circle; property: circle'
        );

        o.circle = new Set([o, o]);
        expect(() => stringify(o)).to.throw(
            Error,
            'Object cannot be stringified because it has a circle; property: circle'
        );

        o.circle = [o, o];
        expect(() => stringify(o)).to.throw(
            Error,
            'Object cannot be stringified because it has a circle; property: circle'
        );

        const a = {
            otherObj: o
        };
        o.circle = {
            inner: {
                foo: a
            }
        };

        expect(() => stringify(o)).to.throw(
            Error,
            'Object cannot be stringified because it has a circle; property: circle'
        );

        // RESET the top-level circle so that it is not encountered
        o.circle = undefined;

        o.bar.deep.deepCircle = o;
        expect(() => stringify(o)).to.throw(
            Error,
            'Object cannot be stringified because it has a circle; property: bar.deep.deepCircle'
        );

        o.bar.deep.deepCircle = {
            inner: {
                foo: a
            }
        };

        expect(() => stringify(o)).to.throw(
            Error,
            'Object cannot be stringified because it has a circle; property: bar.deep.deepCircle.inner.foo.otherObj'
        );
    });

    it('Should META-ENCODE circular references when asked', () => {
        const o: AnyObject = {
            circle1: undefined,
            foo: 'bar',
            nested: {
                prop: 111
            },
            zar: {
                deep: {
                    circle2: undefined,
                    prop: 1
                },
                notCircle: undefined
            }
        };

        o.circle1 = o;
        o.zar.notCircle = o.nested;
        o.zar.deep.circle2 = o.zar;

        expect(stringifyWithCircles(o)).to.equal(
            '{"circle1":"$$CIRCLE:/$$","foo":"bar","nested":{"prop":111},"zar":{"deep":{"circle2":"$$CIRCLE:zar$$","prop":1},"notCircle":{"prop":111}}}'
        );

        const a: AnyObject = {
            a: undefined,
            b: 42
        };
        a.a = a;
        expect(stringifyWithCircles(a)).to.equal('{"a":"$$CIRCLE:/$$","b":42}');

        const arr: any[] = [0, 1, 2, 3];
        arr[0] = arr;
        expect(stringifyWithCircles(arr)).to.equal('["$$CIRCLE:/$$",1,2,3]');
    });

    it('Should stringify objects with repeated but non-circular references', () => {
        const a = {
            foobar: 42
        };
        const o = {
            foo: 'bar',
            obj1: a,
            obj2: {
                bar: a,
                obj: {
                    baz: [a, a],
                    ball: new Map([
                        [1, a],
                        [2, a]
                    ])
                }
            },
            obj3: a
        };
        // IE throws an Error, Chrome throws a RangeError
        const json = stringify(o);
        expect(stringify(o)).to.equal(
            '{"foo":"bar","obj1":{"foobar":42},"obj2":{"bar":{"foobar":42},"obj":{"ball":[[1,{"foobar":42}],[2,{"foobar":42}]],"baz":[{"foobar":42},{"foobar":42}]}},"obj3":{"foobar":42}}'
        );

        const oParsed = JSON.parse(json, (key, value) => (key === 'ball' ? new Map(value) : value));
        expect(oParsed).to.deep.equal(oParsed);
    });

    it('Should stringify Error objects', () => {
        function makeError(): void {
            throw new TypeError('FOO');
        }

        function nestError(): void {
            makeError();
        }

        let errorObj, json;

        try {
            nestError();
        } catch (err) {
            errorObj = err;
            json = stringify(err);

            expect(json).to.have.string('"name":"TypeError"');
            expect(json).to.have.string('"message":"FOO"');
            expect(json).to.have.string('"stack":');

            const oParsed = JSON.parse(json);

            expect(oParsed.name).to.equal(errorObj.name);
            expect(oParsed.message).to.equal(errorObj.message);
            expect(oParsed.stack).to.equal(errorObj.stack);

            return;
        }

        expect(true).to.equal(false);
    });

    it('Should treat special values like JSON.stringify does', () => {
        const vals = [undefined, null, NaN, Infinity, -Infinity, +Infinity, -0, +0];

        // Single values and values as array items are sometimes different for JSON.stringify,
        // e.g. undefined can result in undefined as value or null as array item.
        vals.forEach(value => {
            // As an individual value, or...
            expect(stringify(value), `Testing value ${String(value)}`).to.equal(
                JSON.stringify(value)
            );
            // ...as part of an array
            expect(stringify([value]), `Testing value ${String(value)}`).to.equal(
                JSON.stringify([value])
            );
        });

        // ...or as part of an object value
        const o = vals.reduce((acc, val, idx) => {
            // JS converts keys to strings, always, so no use testing those, only the values
            acc[`v${idx}`] = val;
            return acc;
        }, {} as AnyObject);
        expect(stringify(o)).to.equal(JSON.stringify(o));
    });

    it('Should stringify Map objects', () => {
        const m = new Map();
        m.set(1, 42);
        m.set({foo: 'bar'}, 'object');
        m.set(true, false);

        const json = stringify(m);
        expect(json).to.equal('[[1,42],[true,false],[{"foo":"bar"},"object"]]');
        expect(new Map(JSON.parse(json))).to.deep.equal(m);

        // Repeat with different insertion order
        const m2 = new Map();
        m2.set({foo: 'bar'}, 'object');
        m2.set(true, false);
        m2.set(1, 42);

        const json2 = stringify(m2);
        expect(json2).to.equal('[[1,42],[true,false],[{"foo":"bar"},"object"]]');
        expect(new Map(JSON.parse(json2))).to.deep.equal(m2);
    });

    it('Should stringify Set objects', () => {
        const o = {foo: 'bar'};

        const s = new Set(['foo', 42, 1, o, 42, 1, o, [1, 2, 3]]);

        const json = stringify(s);
        expect(json).to.equal('["foo",1,42,[1,2,3],{"foo":"bar"}]');
        expect(new Set(JSON.parse(json))).to.deep.equal(s);

        // Repeat with different insertion order
        const s2 = new Set([1, 42, o, 'foo', [1, 2, 3], 42, 1, o]);

        const json2 = stringify(s);
        expect(json2).to.equal('["foo",1,42,[1,2,3],{"foo":"bar"}]');
        expect(new Set(JSON.parse(json2))).to.deep.equal(s2);
    });

    it('Should use toJSON method of objects', () => {
        // 1) Object literal
        const obj = {
            foo: 'bar',
            toJSON: () => 'Foo Bar Object'
        };
        expect(stringify(obj)).to.equal(JSON.stringify(obj));

        // 2) Inherited toJSON method
        class Person {
            first: string;
            last: string;

            constructor(first: string, last: string) {
                this.first = first;
                this.last = last;
            }

            toJSON(): AnyObject {
                return {
                    fullName: `${this.first} ${this.last}`
                };
            }
        }

        const person = new Person('MyFirst', 'LastName');
        expect(JSON.stringify(person)).to.equal('{"fullName":"MyFirst LastName"}');
        expect(stringify(person)).to.equal(JSON.stringify(person));
    });

    it('Should not stringify symbols', () => {
        expect(() => stringify(Symbol.for('test'))).to.throw(
            Error,
            'USS-STR4: Promise, Function or Symbol are not allowed: Symbol'
        );

        // Just like JSON.stringify, symbols on object properties are simply ignored
        expect(stringify({foo: Symbol.for('test')})).to.equal('{}');
    });

    it.skip('Should not stringify promises', () => {
        expect(() => stringify(new Promise((_resolve, _reject) => undefined))).to.throw(
            Error,
            'USS-STR4: Promise, Function or Symbol are not allowed: Promise'
        );
        expect(() => stringify({foo: new Promise((_resolve, _reject) => undefined)})).to.throw(
            Error,
            'USS-STR4: Promise, Function or Symbol are not allowed: Promise'
        );
    });

    it.skip('Should stringify promises and symbols', () => {
        expect(stringifyWithCircles(Symbol.for('test'))).to.equal('"$$SYMBOL$$"');
        expect(stringifyWithCircles({foo: Symbol.for('test')})).to.equal('{"foo":"$$SYMBOL$$"}');

        expect(stringifyWithCircles(new Promise((_resolve, _reject) => undefined))).to.equal(
            '"$$PROMISE$$"'
        );
        expect(stringifyWithCircles({foo: new Promise((_resolve, _reject) => undefined)})).to.equal(
            '{"foo":"$$PROMISE$$"}'
        );
    });

    it.skip('Should not stringify functions', () => {
        function test(): void {
            // ...
        }

        expect(() => stringify(test)).to.throw(Error, 'Function cannot be stringified:');
        expect(() => stringify({foo: test})).to.throw(Error, 'Function cannot be stringified:');
    });
});
