/* eslint-disable padding-line-between-statements, no-mixed-operators */

import {expect} from 'chai';

import * as PromiseUtils from '../../lib/util/promise.js';

describe('Promise helpers tests', () => {
    // Function is currently unused.
    //
    // it('should return "anyPromise" that succeeds', () => {
    //     const promises = [
    //         // anyPromise() is a kind of race(), only that it ignores rejected promises. So the
    //         // fastest resolving promise will win.
    //         PromiseUtils.wait(2).then(() => Promise.reject(Error('fuzz'))),
    //         PromiseUtils.wait(4, 20),
    //         PromiseUtils.wait(3).then(() => Promise.reject(Error('foo'))),
    //         PromiseUtils.wait(6).then(() => Promise.reject(Error('bar'))),
    //         PromiseUtils.wait(9, 50)
    //     ];
    //
    //     return expect(PromiseUtils.anyPromise(promises)).to.eventually.equal(20);
    // });

    function makeDelayedResolvingPromise(n: number): Promise<42> {
        return new Promise(resolve => {
            setTimeout(() => resolve(42), n);
        });
    }

    function makeDelayedRejectingPromise(n: number): Promise<void> {
        return new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('Aborted')), n);
        });
    }

    it('should not timeout a 0ms delayed promise with undefined timeout', async () => {
        let result;

        result = await PromiseUtils.timeout(undefined, makeDelayedResolvingPromise(0)).catch(
            err => ({isError: err instanceof Error, name: err.name, msg: err.message})
        );
        expect(result).to.equal(42);

        result = await PromiseUtils.timeout(undefined, makeDelayedRejectingPromise(0)).catch(
            err => ({isError: err instanceof Error, name: err.name, msg: err.message})
        );
        expect(result).to.deep.equal({
            isError: true,
            name: 'Error',
            msg: 'Aborted'
        });
    });

    it('should not timeout a 10ms delayed promise with undefined timeout', async () => {
        let result;

        result = await PromiseUtils.timeout(undefined, makeDelayedResolvingPromise(10)).catch(
            err => ({isError: err instanceof Error, name: err.name, msg: err.message})
        );
        expect(result).to.equal(42);

        result = await PromiseUtils.timeout(undefined, makeDelayedRejectingPromise(10)).catch(
            err => ({isError: err instanceof Error, name: err.name, msg: err.message})
        );
        expect(result).to.deep.equal({
            isError: true,
            name: 'Error',
            msg: 'Aborted'
        });
    });

    it('should not timeout a 0ms delayed promise with 0ms timeout', async () => {
        let result;

        const msg =
            'UPR-TO1: A timeout delay of 0 is hard to predict and therefore not allowed. ' +
            'Does it mean the timeout should occur right away without waiting for the promise?';

        result = await PromiseUtils.timeout(0, makeDelayedResolvingPromise(0)).catch(err => ({
            isError: err instanceof Error,
            name: err.name,
            msg: err.message
        }));
        expect(result).to.deep.equal({
            isError: true,
            name: 'Error',
            msg
        });

        result = await PromiseUtils.timeout(0, makeDelayedRejectingPromise(0)).catch(err => ({
            isError: err instanceof Error,
            name: err.name,
            msg: err.message
        }));
        expect(result).to.deep.equal({
            isError: true,
            name: 'Error',
            msg
        });
    });

    it('should timeout a 5ms delayed promise with 1ms timeout', async () => {
        let result;

        result = await PromiseUtils.timeout(1, makeDelayedResolvingPromise(10)).catch(err => ({
            isError: err instanceof Error,
            name: err.name,
            msg: err.message
        }));
        expect(result).to.deep.equal({
            isError: true,
            name: 'TimeoutError',
            msg: 'UPR-TO: Timeout: [1 ms]'
        });

        result = await PromiseUtils.timeout(1, makeDelayedRejectingPromise(10)).catch(err => ({
            isError: err instanceof Error,
            name: err.name,
            msg: err.message
        }));
        expect(result).to.deep.equal({
            isError: true,
            name: 'TimeoutError',
            msg: 'UPR-TO: Timeout: [1 ms]'
        });
    });

    it('should timeout a 5ms-delayed promise with 1ms timoeut with message', async () => {
        let result;

        result = await PromiseUtils.timeout(1, makeDelayedResolvingPromise(5), 'TXT').catch(
            err => ({
                isError: err instanceof Error,
                name: err.name,
                msg: err.message
            })
        );
        expect(result).to.deep.equal({
            isError: true,
            name: 'TimeoutError',
            msg: 'UPR-TO: Timeout: TXT'
        });

        result = await PromiseUtils.timeout(1, makeDelayedRejectingPromise(5), 'MSG').catch(
            err => ({
                isError: err instanceof Error,
                name: err.name,
                msg: err.message
            })
        );
        expect(result).to.deep.equal({
            isError: true,
            name: 'TimeoutError',
            msg: 'UPR-TO: Timeout: MSG'
        });
    });

    it('should serialize sequentially added functions', async () => {
        let counter = 0;

        // The wait() with the out-of-sequence delays ensure that if the functions were NOT
        // queued the array of return values - after all have resolved - would NOT be a smoothly
        // increasing sequence.
        // noinspection IncrementDecrementResultUsedJS
        const functions = [
            // The one with the longest delay should run first.
            () => PromiseUtils.wait(9, 0).then(() => counter++),
            () => PromiseUtils.wait(5, 0).then(() => counter++),
            () => PromiseUtils.wait(3, 0).then(() => counter++),
            () => PromiseUtils.wait(8, 0).then(() => counter++),
            // Check that a rejected promise does not interrupt the chain. Promise-errors will
            // be converted to normal return values in serialized functions!
            () => PromiseUtils.wait(2).then(() => Promise.reject(Error('foo2'))),
            () => PromiseUtils.wait(1, 0).then(() => counter++),
            () => PromiseUtils.wait(6, 0).then(() => counter++)
        ];

        // Add the functions to the sequencer one by one and simultaneously collect the
        // resulting promises.
        const promises = functions.map(fn => PromiseUtils.serializeWithType('testType', fn));

        await Promise.all([
            expect(await promises[0]).to.equal(0),
            expect(await promises[1]).to.equal(1),
            expect(await promises[2]).to.equal(2),
            expect(await promises[3]).to.equal(3),
            expect((await promises[4].catch(err => err)) instanceof Error).to.equal(true),
            expect((await promises[4].then(() => ({})).catch(err => err)).message).to.equal(
                'Error: foo2'
            ),
            expect(await promises[5]).to.equal(4),
            expect(await promises[6]).to.equal(5)
        ]);
    });

    it('should serialize sequentially added functions and keep order', async () => {
        // Create 5 pairs of promises with the same ID that are inserted and also run at
        // different times.
        // The second one must always come after the first one (serialization call sequence).

        const results = [] as string[];

        const promises = [
            ...new Array(5).fill(0).map((_val, idx) => {
                const id = idx + 1;
                return PromiseUtils.serializeWithType(`test-${id}`, async () => {
                    await PromiseUtils.wait(20);
                    results.push(`1-${id}`);
                    return `1-${id}`;
                });
            }),
            ...new Array(5).fill(0).map((_val, idx) => {
                // ID REVERSED
                const id = 5 - idx;
                return PromiseUtils.serializeWithType(`test-${id}`, async () => {
                    await PromiseUtils.wait(1);
                    results.push(`2-${id}`);
                    return `2-${id}`;
                });
            })
        ];

        // Just to make sure.
        expect(await Promise.all(promises)).to.deep.equal([
            '1-1',
            '1-2',
            '1-3',
            '1-4',
            '1-5',
            '2-5',
            '2-4',
            '2-3',
            '2-2',
            '2-1'
        ]);

        // The actual test - what sequence did they run in?
        expect(results).to.deep.equal([
            '1-1',
            '1-2',
            '1-3',
            '1-4',
            '1-5',
            '2-1',
            '2-2',
            '2-3',
            '2-4',
            '2-5'
        ]);
    });

    it('should retry and reject a rejecting promise-returning function', async () => {
        function fn(): Promise<void> {
            return Promise.reject(new Error());
        }

        return expect(
            (await PromiseUtils.retry(fn, {delay: 10, retries: 3, delayMultiplier: 1}).catch(
                err => err
            )) instanceof Error
        ).to.equal(true);
    });

    it('should retry and finally resolve a promise-returning function', async () => {
        let count = 0;

        function fn(): Promise<42> {
            // noinspection IncrementDecrementResultUsedJS
            return count++ === 3 ? Promise.resolve(42) : Promise.reject(Error('foo'));
        }

        return expect(
            await PromiseUtils.retry(fn, {delay: 10, retries: 3, delayMultiplier: 1})
        ).to.equal(42);
    });

    it('should create a tracking-promise', async () => {
        const p1 = PromiseUtils.createTrackingPromise();

        expect(p1.promise).to.be.an.instanceof(Promise);
        expect(p1.promise.then).to.be.an.instanceof(Function);
        expect(p1.promise.catch).to.be.an.instanceof(Function);
        expect(p1.resolve).to.be.an.instanceof(Function);
        expect(p1.reject).to.be.an.instanceof(Function);

        p1.reject(new Error('foo'));

        // This will throw, see
        // https://stackoverflow.com/questions/42460039/promise-reject-causes-uncaught-in-promise-warning
        try {
            await p1.promise.then(() => {
                expect(true).to.equal(false);
            });
        } catch (err) {
            expect(err).to.be.an.instanceof(Error);
            expect(err.message).to.equal('foo');
        }

        await p1.promise.catch(err => {
            expect(err).to.be.an.instanceof(Error);
            expect(err.message).to.equal('foo');
        });

        try {
            await p1.promise;
            expect(true).to.equal(false);
        } catch (err) {
            expect(err).to.be.an.instanceof(Error);
            expect(err.message).to.equal('foo');
        }

        // Resolves
        const p2 = PromiseUtils.createTrackingPromise();
        p2.resolve(42);
        expect(await p2.promise).to.equal(42);

        // No unhandled promise rejection
        const p3 = PromiseUtils.createTrackingPromise();
        p3.reject(new Error('bar'));
        await PromiseUtils.wait(1);
        expect(true).to.equal(true);

        // Should reject even though there is a default catch() handler (see track. promise code)
        const p4 = PromiseUtils.createTrackingPromise();
        p4.reject(new Error('foo bar'));

        try {
            // Direct promise should still throw
            await p4.promise;
            expect(true).to.equal(false);
        } catch (err) {
            expect(err).to.be.an.instanceof(Error);
            expect(err.message).to.equal('foo bar');
        }

        try {
            // New promise created by chaining a success handler should still throw
            await p4.promise.then(() => 1);
            expect(true).to.equal(false);
        } catch (err) {
            expect(err).to.be.an.instanceof(Error);
            expect(err.message).to.equal('foo bar');
        }
    });
});
