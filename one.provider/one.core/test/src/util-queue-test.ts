import {expect} from 'chai';

import {createSimpleQueue} from '../../lib/util/queue.js';

describe('Queue tests', () => {
    it('should create a queue and queue and dequeue items', () => {
        const q = createSimpleQueue();
        expect(q.size()).to.equal(0);
        expect(q.isEmpty()).to.equal(true);

        q.enqueue(42);
        expect(q.size()).to.equal(1);
        expect(q.isEmpty()).to.equal(false);

        // => 42

        q.enqueue('foo');
        expect(q.size()).to.equal(2);
        expect(q.isEmpty()).to.equal(false);

        // => 42, 'foo'

        q.enqueue({foo: 'bar'});
        expect(q.size()).to.equal(3);
        expect(q.isEmpty()).to.equal(false);

        // => 42, 'foo', {foo: 'bar'}

        q.enqueue({bar: 'foo'});
        expect(q.size()).to.equal(4);
        expect(q.isEmpty()).to.equal(false);

        // => 42, 'foo', {foo: 'bar'}, {bar: 'foo'}

        expect(q.dequeue()).to.deep.equal(42);
        expect(q.size()).to.equal(3);
        expect(q.isEmpty()).to.equal(false);

        // => 'foo', {foo: 'bar'}, {bar: 'foo'}

        q.enqueue({foo: 'bar'});
        expect(q.size()).to.equal(4);
        expect(q.isEmpty()).to.equal(false);

        // => 'foo', {foo: 'bar'}, {bar: 'foo'}, {foo: 'bar'}

        expect(q.dequeue()).to.equal('foo');
        expect(q.size()).to.equal(3);
        expect(q.isEmpty()).to.equal(false);

        // => {foo: 'bar'}, {bar: 'foo'}, {foo: 'bar'}

        expect(q.dequeue()).to.deep.equal({foo: 'bar'});
        expect(q.size()).to.equal(2);
        expect(q.isEmpty()).to.equal(false);

        // => {bar: 'foo'}, {foo: 'bar'}

        q.enqueue({foo: 'bar'});
        expect(q.size()).to.equal(3);
        expect(q.isEmpty()).to.equal(false);

        // => {bar: 'foo'}, {foo: 'bar'}, {foo: 'bar'}

        expect(q.dequeue()).to.deep.equal({bar: 'foo'});
        expect(q.size()).to.equal(2);
        expect(q.isEmpty()).to.equal(false);

        // => {foo: 'bar'}, {foo: 'bar'}

        expect(q.dequeue()).to.deep.equal({foo: 'bar'});
        expect(q.size()).to.equal(1);
        expect(q.isEmpty()).to.equal(false);

        // => {foo: 'bar'}

        expect(q.dequeue()).to.deep.equal({foo: 'bar'});
        expect(q.size()).to.equal(0);
        expect(q.isEmpty()).to.equal(true);

        // Remove from empty
        function removeFn(): void {
            q.dequeue();
        }

        expect(removeFn).to.throw(Error, 'Queue is empty');

        // setup for dequeueN
        q.enqueue(42);
        q.enqueue('foo');
        q.enqueue({sam: 'wise'});
        q.enqueue({foo: 'bar'});
        q.enqueue(42);
        q.enqueue(42);
        q.enqueue('foo');
        q.enqueue({foo: 'bar'});
        q.enqueue({bar: 'foo'});
        expect(q.size()).to.equal(9);
        expect(q.isEmpty()).to.equal(false);

        expect(q.dequeueN(2)).to.deep.equal([42, 'foo']);
        expect(q.dequeueN(4)).to.deep.equal([{sam: 'wise'}, {foo: 'bar'}, 42, 42]);
        expect(q.size()).to.equal(3);
        expect(q.isEmpty()).to.equal(false);

        // Remove more than there are
        function removeNFn(): void {
            q.dequeueN(5);
        }

        expect(removeNFn).to.throw(Error, 'Queue does not have enough elements');

        expect(q.dequeueN(3)).to.deep.equal(['foo', {foo: 'bar'}, {bar: 'foo'}]);
        expect(q.size()).to.equal(0);
        expect(q.isEmpty()).to.equal(true);

        q.enqueueN(['1', 2, '3', 4, 5]);
        expect(q.dequeueN(5)).to.deep.equal(['1', 2, '3', 4, 5]);
        expect(q.size()).to.equal(0);
        expect(q.isEmpty()).to.equal(true);

        q.enqueueN(['1', 2, '3', 4, 5]);
        expect(q.clear()).to.be.undefined;
        expect(q.size()).to.equal(0);
        expect(q.isEmpty()).to.equal(true);
    });
});
