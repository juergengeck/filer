/* eslint-disable no-console, no-await-in-loop, arrow-parens, require-jsdoc, @typescript-eslint/require-await */

import {expect} from 'chai';

import {
    concatArrays,
    createNeverFailAsyncErrorWrapper,
    createRethrowingAsyncErrorWrapper,
    flat,
    memoize
} from '../../lib/util/function.js';

// Overwrite the storage method so that the test does not actually store anything.
describe('Function helpers tests', () => {
    it('Should flatten arrays (depth=1)', () => {
        expect(flat([1, 2, 3, [1, 2, 3, 4, 5], 6, 7, [1, 2, 3], 8, 9])).to.deep.equal([
            1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 8, 9
        ]);

        expect(flat([1, 2, 3, [1, 2, 3, 4, 5, [1, 2, 3]], 6, 7, [1, 2, 3], 8, 9])).to.deep.equal([
            1,
            2,
            3,
            1,
            2,
            3,
            4,
            5,
            [1, 2, 3],
            6,
            7,
            1,
            2,
            3,
            8,
            9
        ]);

        expect(
            flat([123, [1, 2, 5, [1, [1, 2, 3], 2, 3]], 6, 7, [1, 2, 3], 8, 9], 10)
        ).to.deep.equal([123, 1, 2, 5, 1, 1, 2, 3, 2, 3, 6, 7, 1, 2, 3, 8, 9]);

        // Test plus performance test/demo (depth=1)
        const N = [100, 1000, 10000, 100000, 1000000];
        const testArrays = [];
        const lengths = [...N];

        for (let m = 0; m < N.length; m++) {
            const arr = new Array(N[m]);

            testArrays.push(arr);

            for (let i = 0; i < N[m]; i++) {
                const r = Math.random() * N[m];

                if (r < N[m] / 10) {
                    const n = Math.round(Math.random() * 20);
                    arr[i] = new Array(n).fill(Math.random() * N[m]);
                    lengths[m] += n - 1;
                } else {
                    arr[i] = r;
                }
            }
        }

        for (let m = 0; m < N.length; m++) {
            // const tag = testArrays[m].length + ' elements';
            // console.time(tag);
            expect(flat(testArrays[m]).length).to.equal(lengths[m]);
            // console.timeEnd(tag);
        }
    });

    it('Should create arrays without duplicates', () => {
        expect(
            [1, 2, 88, 3, 1, 2, 3, 4, 5, 6, 88, 7, 1, 2, 3, 8, 9, 88].filter(
                (item, index, arr) => arr.indexOf(item) === index
            )
        ).to.deep.equal([1, 2, 88, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('Should create one array from a list of arrays', () => {
        expect(
            concatArrays([1, 2, 88], [3], [1, 2, 3, 4, 5, 6, 88, 7, 1, 2], [3, 8, 9, 88])
        ).to.deep.equal([1, 2, 88, 3, 1, 2, 3, 4, 5, 6, 88, 7, 1, 2, 3, 8, 9, 88]);
        expect(concatArrays([1, 2, 88], [], [3], [])).to.deep.equal([1, 2, 88, 3]);
        expect(concatArrays([1, 2, 88], undefined, [3, undefined])).to.deep.equal([
            1,
            2,
            88,
            3,
            undefined
        ]);
        expect(concatArrays([1, 2, 88], 42, 42, [3])).to.deep.equal([1, 2, 88, 42, 42, 3]);
    });

    /**
     * @param {number} n
     * @returns {Promise<number>}
     */
    function func(n: number): Promise<number> {
        if (n < 10) {
            return Promise.resolve(n);
        } else if (n < 20) {
            return Promise.reject(new TypeError('I am a failed promise!'));
        }

        throw new TypeError('Boo!');
    }

    it('Should create an async. error wrapper function that rethrows', async () => {
        let error: any = null;

        function onError(err: any): void {
            error = err;
        }

        const errorWrapper = createRethrowingAsyncErrorWrapper(onError);
        const wrappedFunc = errorWrapper(func);

        expect(await wrappedFunc(5)).to.equal(5);
        expect(error).to.be.null;

        const r1 = await wrappedFunc(15).catch(err => ({
            isError: err instanceof Error,
            msg: err.message
        }));
        expect(r1).to.deep.equal({
            isError: true,
            msg: 'I am a failed promise!'
        });
        expect(error).to.be.instanceof(Error);
        expect(error.message).to.equal('I am a failed promise!');

        error = null;

        const r2 = await wrappedFunc(25).catch(err => ({
            isError: err instanceof Error,
            msg: err.message
        }));
        expect(r2).to.deep.equal({isError: true, msg: 'Boo!'});
        expect(error).to.be.instanceof(Error);
        expect(error.message).to.equal('Boo!');
    });

    it('Should create an async. error wrapper function that never throws', async () => {
        let error: any = null;

        function onError(err: any): void {
            error = err;
        }

        const errorWrapper = createNeverFailAsyncErrorWrapper(onError);
        const wrappedFunc = errorWrapper(func);

        expect(await wrappedFunc(5)).to.be.undefined;
        expect(error).to.be.null;

        const r1 = await wrappedFunc(15).catch(_err => true);
        expect(r1).to.be.undefined;
        expect(error).to.be.instanceof(Error);
        expect(error.message).to.equal('I am a failed promise!');

        error = null;

        const r2 = await wrappedFunc(25).catch(_err => true);
        expect(r2).to.be.undefined;
        expect(error).to.be.instanceof(Error);
        expect(error.message).to.equal('Boo!');
    });

    it('Should memoize a function', () => {
        function randomFunc(_id: any): number {
            return Math.round(Math.random() * 1000);
        }

        function getTime(): number {
            return Date.now();
        }

        const memoizedRandomFunc = memoize(randomFunc);
        const memoizedGetTimeFunc = memoize(getTime);

        const firstRunVal = memoizedRandomFunc(1);
        const firstRunTime = memoizedGetTimeFunc();

        for (let i = 0; i < 20; i++) {
            expect(memoizedRandomFunc(1)).to.equal(firstRunVal);
            expect(memoizedGetTimeFunc()).to.equal(firstRunTime);
        }

        expect(memoizedRandomFunc(2)).to.not.equal(firstRunVal);
    });

    // it('Should throttle a function', async function test24() {
    //     // eslint-disable-next-line no-invalid-this
    //     this.timeout(12000);
    //
    //     const executionTimes: number[] = [];
    //     let timeOfLastExecution = Date.now();
    //
    //     function testFn(): void {
    //         const previousExecutionTime = timeOfLastExecution;
    //         timeOfLastExecution = Date.now();
    //         executionTimes.push(timeOfLastExecution - previousExecutionTime);
    //     }
    //
    //     const DELAY = 50;
    //
    //     const {throttled} = throttleWithFixedDelay(testFn, DELAY);
    //
    //     for (let i = 0; i < 200; i++) {
    //         await wait(1);
    //         throttled();
    //     }
    //
    //     // There is one more delayed function execution after the for loop ends
    //     await wait(2 * DELAY);
    //
    //     // It can take significantly longer, timeouts are not very reliable. I've seen actual
    //     // delays of 90ms with a setTimeout delay of 50ms.
    //     executionTimes.forEach(time => expect(time).to.be.within(DELAY - 5, DELAY + 1000));
    // });

    // it('Should cancel a scheduled but not yet run throttled function', async () => {
    //     let testFnRan = false;
    //
    //     function testFn(): void {
    //         testFnRan = true;
    //     }
    //
    //     const DELAY = 50;
    //
    //     const {cancel, throttled} = throttleWithFixedDelay(testFn, DELAY);
    //
    //     throttled();
    //
    //     await wait(DELAY / 10);
    //
    //     cancel();
    //
    //     await wait(2 * DELAY);
    //
    //     expect(testFnRan).to.be.false;
    // });

    // it('Should throttle a function that throws', async () => {
    //     const DELAY = 5;
    //
    //     function testFn(): void {
    //         throw new Error('An error');
    //     }
    //
    //     let error: any = null;
    //
    //     function onError(err: any): void {
    //         error = err;
    //     }
    //
    //     const {throttled} = throttleWithFixedDelay(testFn, DELAY, onError);
    //
    //     throttled();
    //
    //     // There is one more delayed function execution after the for loop ends
    //     await wait(2 * DELAY);
    //
    //     expect(typeof error).to.equal('object');
    //     expect(typeof error.message).to.equal('string');
    //     expect(error.message).to.equal('An error');
    // });

    // it('Should throttle an asynchronous function whose promise is rejected', async () => {
    //     const DELAY = 5;
    //
    //     async function testFn(): Promise<void> {
    //         throw new Error('An asynchronous error');
    //     }
    //
    //     let error: any = null;
    //
    //     function onError(err: any): void {
    //         error = err;
    //     }
    //
    //     /**
    //      * @type {ThrottledFunction}
    //      */
    //     const {throttled} = throttleWithFixedDelay(testFn, DELAY, onError);
    //
    //     throttled();
    //
    //     // There is one more delayed function execution after the for loop ends
    //     await wait(2 * DELAY);
    //
    //     expect(typeof error).to.equal('object');
    //     expect(typeof error.message).to.equal('string');
    //     expect(error.message).to.equal('An asynchronous error');
    // });
});
