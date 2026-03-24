/* eslint-disable @typescript-eslint/no-unsafe-call */

import {expect} from 'chai';

import {addCoreRecipesToRuntime, clearRuntimeRecipes} from '../../lib/object-recipes.js';
import {convertObjToIdMicrodata} from '../../lib/object-to-microdata.js';
import * as CryptoHelpers from '../../lib/system/crypto-helpers.js';
import type {AnyFunction} from '../../lib/util/function.js';
import type {AnyObject} from '../../lib/util/object.js';
import {
    calculateHashOfObj,
    calculateIdHashOfObj,
    createReadonlyTrackingObj
} from '../../lib/util/object.js';
import type {SHA256Hash} from '../../lib/util/type-checks.js';

import type {OneTest$Email, OneTest$ImapAccount} from './_register-types.js';
import {addTestTypes} from './_register-types.js';

describe('Object helpers tests', () => {
    // Make sure the test file about to be created does not exist yet. We can just
    // blindly delete it because the name is the crypto hash of content that won't
    // occur anywhere else and is therefore unique to this test.
    before(async () => {
        addCoreRecipesToRuntime();
        addTestTypes();
    });
    after(clearRuntimeRecipes);

    it('calculateIdHashOfObj should create ID obj. different from one with only ID properties', async () => {
        const emailObj: OneTest$Email = {
            $type$: 'OneTest$Email',
            messageID: 'randomMsgId@email',
            date: Date.now(),
            subject: 'Subject line'
        };

        expect(await calculateIdHashOfObj(emailObj)).to.not.equal(
            await calculateHashOfObj(emailObj)
        );
    });

    it('calculateObjIdHash should create object ID', async () => {
        const imapAcctObj: OneTest$ImapAccount = {
            $type$: 'OneTest$ImapAccount',
            DUMMY: 42,
            email: 'hasenstein@yahoo.com',
            host: 'demo.somewhere.com',
            user: 'testuser',
            password:
                'fcfbfb1301e2cd426744d8d8f81794547f9225371b8c4e122ecea1596b441d81' as SHA256Hash,
            port: 42
        } as const;

        expect(await calculateIdHashOfObj(imapAcctObj)).to.equal(
            // ID hash
            await CryptoHelpers.createCryptoHash(convertObjToIdMicrodata(imapAcctObj))
        );
    });

    it('calculateIdHashOfObj should throw an error when given an imploded object', async () => {
        try {
            // This object has an ID property that is a reference
            await calculateIdHashOfObj({
                $type$: 'Instance',
                name: 'Instance Name',
                owner: {
                    $type$: 'Person',
                    email: 'someone@somewhere.org'
                },
                recipe: new Set()
            } as any);
            expect(false, 'Function should have thrown an error').to.be.true;
        } catch (error) {
            expect(error, error).to.be.instanceof(Error);
            expect(error.message).to.include(
                'O2M-RTYC4: Value for hash-link itemprop "owner" should be SHA-256 hash (lower case hex 64 characters), Value: {"$type$":"Person","email":"someone@somewhere.org"}'
            );
        }
    });

    it('calculateHashOfObj should throw an error when given an imploded object', async () => {
        try {
            await calculateHashOfObj({
                $type$: 'OneTest$Email',
                messageID: 'dummy-123.123@dummy.com',
                from: [{$type$: 'Person', email: 'Asomeone@somewhere.org'}],
                to: [{$type$: 'Person', email: 'Bsomeother@someother.com'}],
                subject: 'Imploded dummy email',
                date: 1438424218122
            } as any);
            expect(false, 'Function should have thrown an error').to.be.true;
        } catch (error) {
            expect(error, error).to.be.instanceof(Error);
            expect(error.message).to.include(
                'O2M-RTYC4: Value for hash-link itemprop "from" should be SHA-256 hash (lower case hex 64 characters), Value: {"$type$":"Person","email":"Asomeone@somewhere.org"}'
            );
        }
    });

    it('should create a read-only real-time tracking object of an object', () => {
        const o: AnyObject = {
            a: 1,
            b: true,
            c: [1, 2, 3],
            d: {foo: 'bar'},
            sym: Symbol.for('test'),
            s: new Set(['a1', 'v2', 'bbb']),
            m: new Map([
                ['v1', 'aaa'],
                ['v2', 'bbb']
            ])
        };

        const trackingObj: AnyObject = createReadonlyTrackingObj(o);

        function readFn(key: string): AnyFunction {
            return () => trackingObj[key];
        }

        // Access to all primitive type properties only
        expect(trackingObj.a).to.equal(1);
        expect(trackingObj.b).to.equal(true);
        expect(typeof trackingObj.c).to.equal('object');
        expect(typeof trackingObj.c).to.equal('object');
        expect(readFn('d')).to.throw(Error, 'Access to "d" denied: Reference to a mutable object');
        expect(typeof trackingObj.s).to.equal('object');
        expect(trackingObj.s.has('v2')).to.be.true;
        expect(trackingObj.s.has('noSuchKey')).to.be.false;
        expect(trackingObj.s.toString()).to.equal('[object ReadonlySet]');
        expect(trackingObj.m instanceof Map).to.be.false;
        expect(trackingObj.m instanceof Object).to.be.true;
        expect(trackingObj.s instanceof Set).to.be.false;
        expect(trackingObj.s instanceof Object).to.be.true;
        expect(String(trackingObj.s)).to.equal('[object ReadonlySet]');
        expect(trackingObj.m.toString()).to.equal('[object ReadonlyMap]');
        expect(String(trackingObj.m)).to.equal('[object ReadonlyMap]');
        expect(trackingObj.c[0]).to.equal(1);
        expect(trackingObj.c[1]).to.equal(2);
        expect(trackingObj.c[2]).to.equal(3);
        expect(trackingObj.c[3]).to.be.undefined;
        expect([...trackingObj.c]).to.deep.equal([1, 2, 3]);
        expect(trackingObj.sym).to.equal(Symbol.for('test'));
        expect(trackingObj.m.has('v2')).to.be.true;
        expect(trackingObj.m.has('noSuchKey')).to.be.false;
        expect(trackingObj.m.get('v2')).to.equal('bbb');
        expect(trackingObj.m.get('noSuchKey')).to.be.undefined;
        expect([...trackingObj.m.keys()]).to.deep.equal(['v1', 'v2']);
        expect([...trackingObj.m.values()]).to.deep.equal(['aaa', 'bbb']);
        expect([...trackingObj.s.keys()]).to.deep.equal(['a1', 'v2', 'bbb']);
        expect([...trackingObj.s.values()]).to.deep.equal(['a1', 'v2', 'bbb']);

        expect(() => (trackingObj.a = 'other')).to.throw(Error, 'Write access to "a" denied');
        expect(() => (trackingObj.b = 'other')).to.throw(Error, 'Write access to "b" denied');
        expect(() => (trackingObj.c = 'other')).to.throw(Error, 'Write access to "c" denied');
        expect(() => (trackingObj.c[0] = 444)).to.throw(Error, 'Write access to "c[0]" denied');
        expect(() => (trackingObj.c[6] = 444)).to.throw(Error, 'Write access to "c[6]" denied');
        expect(() => (trackingObj.d = 'other')).to.throw(Error, 'Write access to "d" denied');
        expect(() => (trackingObj.sym = 'other')).to.throw(Error, 'Write access to "sym" denied');
        expect(() => (trackingObj.s = 'other')).to.throw(Error, 'Write access to "s" denied');
        expect(() => trackingObj.s.add('newKey')).to.throw(
            Error,
            'trackingObj.s.add is not a function'
        );
        expect(() => trackingObj.s.clear()).to.throw(
            Error,
            'trackingObj.s.clear is not a function'
        );
        expect(() => (trackingObj.m = 'other')).to.throw(Error, 'Write access to "m" denied');
        expect(() => trackingObj.m.set('newKey', 'newVal')).to.throw(
            Error,
            'trackingObj.m.set is not a function'
        );
        expect(() => trackingObj.m.clear()).to.throw(
            Error,
            'trackingObj.m.clear is not a function'
        );

        // Does it track changes?
        o.a = 42;
        o.b = false;
        o.sym = Symbol.for('other');
        expect(trackingObj.a).to.equal(42);
        expect(trackingObj.b).to.equal(false);
        expect(trackingObj.sym).to.equal(Symbol.for('other'));

        // Change the type of value (temporarily)
        // Does it deny access now?
        o.a = [5, 6, 7];
        expect([...trackingObj.a]).to.deep.equal([5, 6, 7]);

        // Reset to original state
        o.a = 1;
        o.b = true;
        o.sym = Symbol.for('test');

        // Access to all properties including object references (DANGER - mutable)
        const trackingObjWithReferences = createReadonlyTrackingObj(o, true);

        expect(trackingObjWithReferences).to.deep.equal(o);
        o.a = 123;
        o.b = 123;
        o.c = false;
        o.sym = Symbol.for('luck');
        trackingObjWithReferences.d.newProp = 1; // Mutate the referenced object - no protection
        expect(trackingObjWithReferences).to.deep.equal(o);
    });
});
