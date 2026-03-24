/**
 * This class can spawn multiple promises and you can resolve / reject multiple ones at the same
 * time.
 */
export default class MultiPromise<T, TErr = any> {
    private resolveRejectFns: {resolve: (arg: T) => void; reject: (arg: TErr) => void}[] = [];
    private readonly defaultTimeout: number;
    private readonly maxPendingPromiseCount: number;

    /**
     * Constructor.
     * @param maxPendingPromiseCount - Maximum number of unresolved promises before the
     * createPromise function throws.
     * @param defaultTimeout - The default timeout for newly created promises.
     */
    constructor(
        maxPendingPromiseCount = Number.POSITIVE_INFINITY,
        defaultTimeout = Number.POSITIVE_INFINITY
    ) {
        this.defaultTimeout = defaultTimeout;
        this.maxPendingPromiseCount = maxPendingPromiseCount;
    }

    /**
     * Get the number of pending promises.
     */
    get pendingPromiseCount(): number {
        return this.resolveRejectFns.length;
    }

    /**
     * Add a new promise.
     *
     * Note that this function will throw synchronous when the number of pending promises has
     * been exceeded (>= maxPendingPromiseCount).
     *
     * @param timeout - Timeout as unsigned 32-bit integer or Number.POSITIVE_INFINITY. If
     *                  undefined use the default value passed to the constructor.
     */
    public addNewPromise(timeout?: number): Promise<T> {
        if (timeout === undefined) {
            timeout = this.defaultTimeout;
        }
        if (this.resolveRejectFns.length >= this.maxPendingPromiseCount) {
            throw new Error('Maximum number of allowed pending promises reached.');
        }

        return new Promise((resolve, reject) => {
            // Start the timeout for waiting on a new message
            let timeoutHandle: any = null;

            if (timeout !== Number.POSITIVE_INFINITY) {
                timeoutHandle = setTimeout(() => {
                    this.removeResolveRejectFunctions(resolveRejectFn);
                    reject(new Error('Timeout expired'));
                }, timeout);
            }

            const resolveRejectFn = {
                resolve: (arg: T): void => {
                    if (timeoutHandle !== null) {
                        clearTimeout(timeoutHandle);
                    }
                    this.removeResolveRejectFunctions(resolveRejectFn);
                    resolve(arg);
                },
                reject: (arg: TErr): void => {
                    if (timeoutHandle !== null) {
                        clearTimeout(timeoutHandle);
                    }
                    this.removeResolveRejectFunctions(resolveRejectFn);
                    reject(arg);
                }
            };

            this.addResolveRejectFunctions(resolveRejectFn);
        });
    }

    /**
     * Resolve the promise that was added last.
     *
     * @param arg - argument with which to resolve the promise.
     */
    public resolveLast(arg: T): boolean {
        const fns = this.resolveRejectFns.pop();

        if (fns === undefined) {
            return false;
        }

        fns.resolve(arg);
        return true;
    }

    /**
     * Reject the promise that was added last.
     *
     * @param err - argument with which to reject the promise.
     */
    public rejectLast(err: TErr): boolean {
        const fns = this.resolveRejectFns.pop();

        if (fns === undefined) {
            return false;
        }

        fns.reject(err);
        return true;
    }

    /**
     * Resolve the promise that was added first.
     *
     * @param arg - argument with which to resolve the promise.
     */
    public resolveFirst(arg: T): boolean {
        const fns = this.resolveRejectFns.shift();

        if (fns === undefined) {
            return false;
        }

        fns.resolve(arg);
        return true;
    }

    /**
     * Reject the promise that was added first.
     *
     * @param err - argument with which to reject the promise.
     */
    public rejectFirst(err: TErr): boolean {
        const fns = this.resolveRejectFns.shift();

        if (fns === undefined) {
            return false;
        }

        fns.reject(err);
        return true;
    }

    /**
     * Resolve all promises.
     *
     * @param arg - argument with which to resolve the promises.
     */
    public resolveAll(arg: T): boolean {
        if (this.resolveRejectFns.length === 0) {
            return false;
        }

        for (const fns of this.resolveRejectFns) {
            fns.resolve(arg);
        }
        return true;
    }

    /**
     * Reject all promises.
     *
     * @param err - argument with which to reject the promises.
     */
    public rejectAll(err: TErr): boolean {
        if (this.resolveRejectFns.length === 0) {
            return false;
        }

        for (const fns of this.resolveRejectFns) {
            fns.reject(err);
        }
        return true;
    }

    /**
     * Remove the listener callbacks from dataListener.
     *
     * @private
     * @param resolveRejectFn
     */
    private removeResolveRejectFunctions(resolveRejectFn: {
        resolve: (arg: T) => void;
        reject: (arg: TErr) => void;
    }) {
        this.resolveRejectFns = this.resolveRejectFns.filter(f => resolveRejectFn !== f);
    }

    /**
     * Add the listener callback to dataListener.
     *
     * @private
     * @param resolveRejectFn
     */
    private addResolveRejectFunctions(resolveRejectFn: {
        resolve: (arg: T) => void;
        reject: (arg: TErr) => void;
    }) {
        this.resolveRejectFns.push(resolveRejectFn);
    }
}
