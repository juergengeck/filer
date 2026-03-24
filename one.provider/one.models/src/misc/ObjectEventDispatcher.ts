import type {VersionedObjectResult} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {
    getIdObject,
    onIdObj,
    onVersionedObj
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {ensureVersionedObjectTypeName} from '@refinio/one.core/lib/object-recipes.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {onUnversionedObj} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {
    OneUnversionedObjectInterfaces,
    OneVersionedObjectInterfaces
} from '@OneObjectInterfaces';
import {SettingsStore} from '@refinio/one.core/lib/system/settings-store.js';
import {
    enableStatistics,
    type CallStatistics,
    getStatistics,
    resetStatistics
} from '@refinio/one.core/lib/util/object-io-statistics.js';
import {ensureIdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {FileCreationStatus} from '@refinio/one.core/lib/storage-base-common.js';
import type {
    OneIdObjectTypes,
    OneUnversionedObjectTypeNames,
    OneVersionedObjectTypeNames
} from '@refinio/one.core/lib/recipes.js';
import BlockingPriorityQueue from './BlockingPriorityQueue.js';
import {getOrCreate} from '../utils/MapUtils.js';
import {OEvent} from './OEvent.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';

const MessageBus = createMessageBus('ObjectEventDispatcher');

// ######## Id/Versioned/Unversioned Object Result type stuff ########

/**
 * IdObjectResult is analog to [V|Unv]ersionedObjectResult.
 *
 * One.core has no such type for onIdObj events.
 */
export interface IdObjectResult<T extends OneIdObjectTypes = OneIdObjectTypes> {
    readonly obj: T;
    hash?: void;
    idHash: SHA256IdHash<OneVersionedObjectInterfaces[T['$type$']]>;
    status: FileCreationStatus;
    timestamp?: void;
}

/**
 * Concatenation of all result types.
 */
export type AnyObjectResult = VersionedObjectResult | UnversionedObjectResult | IdObjectResult;

/**
 * Translates '*' to OneVersionedObjectTypeNames
 */
type OneVersionedObjectTypeNamesOrStar<T extends OneVersionedObjectTypeNames | '*'> =
    T extends OneVersionedObjectTypeNames ? T : OneVersionedObjectTypeNames;

/**
 * Translates '*' to OneUnersionedObjectTypeNames
 */
type OneUnversionedObjectTypeNamesOrStar<T extends OneUnversionedObjectTypeNames | '*'> =
    T extends OneUnversionedObjectTypeNames ? T : OneUnversionedObjectTypeNames;

// ######## Main types used by class ########

/**
 * Stores information about the registered object event handler
 */
export type HandlerInfo<T extends AnyObjectResult = AnyObjectResult> = {
    cb: (result: T) => Promise<void> | void;
    description: string;
    callStack?: string;

    // Statistics
    registerTime: number;
    deregisterTime?: number;
    executionStatistics: {
        startTime: number;
        endTime: number;
        hash?: SHA256Hash;
        idHash?: SHA256IdHash;
        error?: any;
        ioCallStatistics?: CallStatistics;
    }[];
};

// ######## Convenience types for statistics  - Handlers ########

/**
 * Filter specified in newVersion handlers.
 */
type VersionedFilterType =
    | {
          filterType: OneVersionedObjectTypeNames;
          filterIdHash: SHA256IdHash | '*';
      }
    | {
          filterType: '*';
          filterIdHash: '*';
      };

/**
 * Convenience representation of onNewVersion handlers for easier type checking.
 */
export type PublicVersionedHandlerInfo = HandlerInfo<VersionedObjectResult> & {
    type: 'onNewVersion';
} & VersionedFilterType;

/**
 * Convenience representation of onUnversionedObject handlers for easier type checking.
 */
export type PublicUnversionedHandlerInfo = HandlerInfo<UnversionedObjectResult> & {
    type: 'onUnversionedObject';
    filterType: OneUnversionedObjectTypeNames | '*';
};

/**
 * Convenience representation of onIdObject handlers for easier type checking.
 */
export type PublicIdHandlerInfo = HandlerInfo<IdObjectResult> & {
    type: 'onIdObject';
    filterType: OneVersionedObjectTypeNames | '*';
};

/**
 * Generic representation of object handlers.
 *
 * Check type property to know which type of handler is is.
 */
export type PublicHandlerInfo =
    | PublicVersionedHandlerInfo
    | PublicUnversionedHandlerInfo
    | PublicIdHandlerInfo;

// ######## Convenience types for statistics - Buffer history ########

/**
 * Buffer history for all types of object results.
 */
type GenericBufferHistoryData<T extends AnyObjectResult = AnyObjectResult> = {
    result: T;

    startTime: number;
    endTime: number;

    handler: {
        info: HandlerInfo<T>;
        startTime: number;
        endTime: number;
        error?: any;
        ioCallStatistics?: CallStatistics;
    }[];
};

/**
 * Convenience type that stores the type of the result in the 'type' field.
 */
export type BufferHistoryData =
    | ({
          type: 'VersionedObject';
      } & GenericBufferHistoryData<VersionedObjectResult>)
    | ({
          type: 'UnversionedObject';
      } & GenericBufferHistoryData<UnversionedObjectResult>)
    | ({
          type: 'IdObject';
      } & GenericBufferHistoryData<IdObjectResult>);

/**
 * The object event dispatcher collects all object events from one.core and reemits them in a
 * controlled fashion.
 *
 * - calls are serialized
 * - the interface is much more puwerful than that of one.core
 * - statistics make it much easier to debug stuff
 */
export default class ObjectEventDispatcher {
    onError = new OEvent<(err: any) => void>();
    onGlobalStatisticChanged = new OEvent<() => void>();
    onPauseStateChanged = new OEvent<(paused: boolean) => void>();

    /**
     * This option discards objects for which nobody listens before they are pushed to the buffer.
     *
     * This might have the drawback that if an object in the buffer causes a new event listener
     * to be registered, the new event listener will miss such objects. This might not be a
     * problem at the moment, because such objects will already be on disk (That's why it is
     * enabled by default).
     */
    enableEnqueueFiltering = true;

    /**
     * The application can override the priority values for results that are enqueued by setting
     * a function here.
     *
     * Lesser values will result in a higher priority.
     *
     * @param result - The result value that shall be enqueued.
     */
    determinePriorityOverride: ((result: AnyObjectResult) => number) | undefined;

    // ######## private properties ########

    /**
     * Buffer that buffers all one.core events.
     * @private
     */
    private buffer = new BlockingPriorityQueue<
        VersionedObjectResult | UnversionedObjectResult | IdObjectResult
    >(Number.POSITIVE_INFINITY, 1);

    private bufferHistory: BufferHistoryData[] = [];

    // #### event handler ####

    private newVersionHandler = new Map<
        string, // This is OneVersionedObjectTypeNames | '*' | <type>+Hash
        Array<HandlerInfo<VersionedObjectResult>>
    >();
    private newUnversionedObjectHandler = new Map<
        OneUnversionedObjectTypeNames | '*',
        Array<HandlerInfo<UnversionedObjectResult>>
    >();
    private newIdHandler = new Map<
        OneVersionedObjectTypeNames | '*',
        Array<HandlerInfo<IdObjectResult>>
    >();

    // #### Members for stopping / pausing the event loop ####
    private stopped = true;
    private waitForEventLoopDonePromise: Promise<void> | null = null;
    private disconnect: (() => void) | undefined;

    private pausePromise: Promise<void> | undefined;
    private pauseResume: (() => void) | undefined;

    // Statistics of old / disconnected handlers
    private oldVersionHandler = new Map<
        string, // This is OneVersionedObjectTypeNames | '*' | <type>+Hash
        Array<HandlerInfo<VersionedObjectResult>>
    >();
    private oldUnversionedObjectHandler = new Map<
        OneUnversionedObjectTypeNames | '*',
        Array<HandlerInfo<UnversionedObjectResult>>
    >();
    private oldIdHandler = new Map<
        OneVersionedObjectTypeNames | '*',
        Array<HandlerInfo<IdObjectResult>>
    >();
    private totalExecutionCount = 0;

    // ######## init / shutdown ########

    async init() {
        if (this.disconnect !== undefined) {
            throw new Error('ObjectEventDispatcher is already initialized.');
        }

        const d1 = onVersionedObj.addListener((result) => {
            return this.appendToBufferIfNew(result);
        });
        
        const d2 = onUnversionedObj.addListener(this.appendToBufferIfNew.bind(this));
        
        const d3 = onIdObj.addListener(result => {
            getIdObject(result.idHash)
                .then(obj => {
                    const idObjResult: IdObjectResult = {
                        obj,
                        idHash: result.idHash as SHA256IdHash,
                        status: result.status
                    };
                    this.appendToBufferIfNew(idObjResult);
                })
                .catch(this.onError.emit.bind(this.onError));
        });

        this.disconnect = () => {
            d1();
            d2();
            d3();
        };

        this.startDispatchLoop().catch(this.onError.emit.bind(this.onError));
    }

    async shutdown() {
        if (this.disconnect === undefined) {
            return;
        }

        this.disconnect();
        this.disconnect = undefined;
        this.stopped = true;
        this.resume();
        this.buffer.cancelPendingPromises();
        if (this.waitForEventLoopDonePromise) {
            await this.waitForEventLoopDonePromise;
        }
    }

    // ######## start / pause event handling ########

    pause(): void {
        if (this.pausePromise) {
            throw new Error('Already paused');
        }

        this.pausePromise = new Promise(resolve => {
            this.pauseResume = resolve;
            this.onPauseStateChanged.emit(true);
        });
    }

    resume(): void {
        if (this.pauseResume) {
            this.pausePromise = undefined;
            this.onPauseStateChanged.emit(false);
            this.pauseResume();
        }
    }

    isPaused(): boolean {
        return this.pausePromise !== undefined;
    }

    // ######## Event handler registration ########

    onNewVersion<T extends OneVersionedObjectTypeNames | '*'>(
        cb: (
            result: VersionedObjectResult<
                OneVersionedObjectInterfaces[OneVersionedObjectTypeNamesOrStar<T>]
            >
        ) => Promise<void> | void,
        description: string,
        type: T | '*' = '*',
        idHash:
            | SHA256IdHash<OneVersionedObjectInterfaces[OneVersionedObjectTypeNamesOrStar<T>]>
            | '*' = '*'
    ): () => void {
        const filterKey = idHash === '*' ? type : `${type}+${idHash}`;
        MessageBus.send('debug', `[OBJECT_EVENTS] onNewVersion - Registering handler: ${description}, filter: ${filterKey}`);
        
        const entry = getOrCreate(
            this.newVersionHandler,
            filterKey,
            []
        );

        entry.push({
            cb: cb as (result: VersionedObjectResult) => Promise<void> | void,
            description,
            callStack: new Error('').stack,
            registerTime: Date.now(),
            executionStatistics: []
        });
        
        MessageBus.send('debug', `[OBJECT_EVENTS] onNewVersion - Handler registered: ${description}`);

        return () => {
            MessageBus.send('debug', `[OBJECT_EVENTS] onNewVersion - Handler deregistered: ${description}`);
            const i = entry.findIndex(h => h.cb === cb);
            if (i < 0) {
                return;
            }

            const oldHandlers = entry.splice(i, 1);

            if (this.retainDeregisteredHandlers) {
                const deregisterTime = Date.now();
                const oldEntry = getOrCreate(this.oldVersionHandler, type, []);

                for (const oldHandler of oldHandlers) {
                    oldHandler.deregisterTime = deregisterTime;
                }

                oldEntry.push(...oldHandlers);
            }
        };
    }

    onUnversionedObject<T extends OneUnversionedObjectTypeNames | '*'>(
        cb: (
            result: UnversionedObjectResult<
                OneUnversionedObjectInterfaces[OneUnversionedObjectTypeNamesOrStar<T>]
            >
        ) => Promise<void> | void,
        description: string,
        type: T | '*' = '*'
    ): () => void {
        const entry = getOrCreate(this.newUnversionedObjectHandler, type, []);

        entry.push({
            cb: cb as (result: UnversionedObjectResult) => Promise<void> | void,
            description,
            callStack: new Error('').stack,
            registerTime: Date.now(),
            executionStatistics: []
        });

        return () => {
            const i = entry.findIndex(h => h.cb === cb);
            if (i < 0) {
                return;
            }

            const oldHandlers = entry.splice(i, 1);

            if (this.retainDeregisteredHandlers) {
                const deregisterTime = Date.now();
                const oldEntry = getOrCreate(this.oldUnversionedObjectHandler, type, []);

                for (const oldHandler of oldHandlers) {
                    oldHandler.deregisterTime = deregisterTime;
                }

                oldEntry.push(...oldHandlers);
            }
        };
    }

    onNewIdObject<T extends OneVersionedObjectTypeNames | '*'>(
        cb: (
            result: IdObjectResult<
                OneVersionedObjectInterfaces[OneVersionedObjectTypeNamesOrStar<T>]
            >
        ) => Promise<void> | void,
        description: string,
        type: T | '*' = '*'
    ): () => void {
        const entry = getOrCreate(this.newIdHandler, type, []);

        entry.push({
            cb: cb as (result: IdObjectResult) => Promise<void> | void,
            description,
            callStack: new Error('').stack,
            registerTime: Date.now(),
            executionStatistics: []
        });

        return () => {
            const i = entry.findIndex(h => h.cb === cb);
            if (i < 0) {
                return;
            }

            const oldHandlers = entry.splice(i, 1);

            if (this.retainDeregisteredHandlers) {
                const deregisterTime = Date.now();
                const oldEntry = getOrCreate(this.newIdHandler, type, []);

                for (const oldHandler of oldHandlers) {
                    oldHandler.deregisterTime = deregisterTime;
                }

                oldEntry.push(...oldHandlers);
            }
        };
    }

    static determinePriority(result: AnyObjectResult): number {
        if (result.obj.$type$ === 'Profile') {
            return 10;
        }

        return 0;
    }

    // ######## status & statistics ########

    // Global

    /**
     * If disabled no statistics except the global statistics are computed.
     *
     * Global statistics ar the global event counters.
     */
    enableStatistics = true;

    /**
     * If true, then I/O call statistics are recorded during handler execution.
     *
     * Note that this might accumulate a lot of data and reduce performance.
     */
    enableIOCallStatistics = false;

    // Statistic 1: Number of objects processed

    /**
     * Get the number of objects that were processed by the buffer.
     */
    get totalObjectCount(): number {
        return this.totalExecutionCount;
    }

    /**
     * Resets the total execution count.
     */
    resetTotalObjectCount(): void {
        this.totalExecutionCount = 0;
    }

    // Statistic 2: Pending objects

    /**
     * Get the number of objects that wait to be processed.
     */
    get pendingObjectCount(): number {
        return this.buffer.length;
    }

    /**
     * Get a list of pending objects (result type of objects, that includes hashes etc)
     *
     * Objects are deep frozen, the array is a copy.
     */
    getPendingObjects(): AnyObjectResult[] {
        return this.buffer.data;
    }

    // Statistic 3: Processed objects

    /**
     * Number of processed object information to retain.
     *
     * -1 means unlimited, which will result in a serious memory leak.
     */
    maxProcessedObjectCount = 10;

    /**
     * Get a list of objects that have recently been processed plus statistics data for them.
     */
    getProcessedObjects(): BufferHistoryData[] {
        return [...this.bufferHistory];
    }

    /**
     * Clears the whole buffer history.
     */
    clearProcessedObjects(): void {
        this.bufferHistory = [];
    }

    // Statistic 4: Statistics regarding registered handler

    /**
     * If true this will retain all handler that have been deregistered.
     *
     * This is useful to keep track of temporary callbacks (like the ones used in react views)
     */
    retainDeregisteredHandlers = false;

    /**
     * How many execution statistics per callback are stored.
     *
     * -1 means unlimited, which will result in a serious memory leak.
     */
    maxExecutionStatisticsPerHandler = 10;

    /**
     * Get a list of all registered handlers and if 'retainDeregisteredCallbacks' is enabled
     * also deregistered ones.
     */
    getHandlerStatistics(): PublicHandlerInfo[] {
        const arr: PublicHandlerInfo[] = [];

        for (const [key, handler] of [
            ...this.newVersionHandler.entries(),
            ...this.oldVersionHandler.entries()
        ]) {
            let filter: VersionedFilterType;
            const elems = key.split('+');

            if (elems.length === 2) {
                filter = {
                    filterType: ensureVersionedObjectTypeName(elems[0]),
                    filterIdHash: ensureIdHash(elems[1])
                };
            } else if (elems.length === 1) {
                if (elems[0] === '*') {
                    filter = {
                        filterType: '*',
                        filterIdHash: '*'
                    };
                } else {
                    filter = {
                        filterType: ensureVersionedObjectTypeName(elems[0]),
                        filterIdHash: '*'
                    };
                }
            } else {
                throw new Error('Internal formatting error (1)');
            }

            for (const h of handler) {
                arr.push({
                    type: 'onNewVersion',
                    ...filter,
                    ...h
                });
            }
        }

        for (const [key, handler] of [
            ...this.newUnversionedObjectHandler.entries(),
            ...this.oldUnversionedObjectHandler.entries()
        ]) {
            for (const h of handler) {
                arr.push({
                    type: 'onUnversionedObject',
                    filterType: key,
                    ...h
                });
            }
        }

        for (const [key, handler] of [
            ...this.newIdHandler.entries(),
            ...this.oldIdHandler.entries()
        ]) {
            for (const h of handler) {
                arr.push({
                    type: 'onIdObject',
                    filterType: key,
                    ...h
                });
            }
        }

        return arr;
    }

    /**
     * Clear all execution statistics of handlers
     */
    clearHandlerStatistics(): void {
        for (const [_key, handler] of [
            ...this.newVersionHandler.entries(),
            ...this.oldVersionHandler.entries(),
            ...this.newUnversionedObjectHandler.entries(),
            ...this.oldUnversionedObjectHandler.entries(),
            ...this.newIdHandler.entries(),
            ...this.oldIdHandler.entries()
        ]) {
            for (const h of handler) {
                h.executionStatistics = [];
            }
        }
    }

    // ######## Store / Load settings ########

    /**
     * Load all settings from localStorage.
     *
     * If no settings are present - use sensible defaults.
     */
    async loadSettings(): Promise<void> {
        const lvalue = await SettingsStore.getItem('objectEventDispatcherStatisticsSettings');

        if (lvalue === undefined) {
            return;
        }

        if (typeof lvalue !== 'string') {
            throw new Error(
                'loadSettings: Malformed objectEventDispatcherStatisticsSettings in local storage'
            );
        }

        const settingsObj = JSON.parse(lvalue);
        this.enableStatistics = settingsObj.enableStatistics;
        this.enableIOCallStatistics = settingsObj.enableIOCallStatistics;
        this.maxProcessedObjectCount = settingsObj.maxProcessedObjectCount;
        this.retainDeregisteredHandlers = settingsObj.retainDeregisteredHandlers;
        this.maxExecutionStatisticsPerHandler = settingsObj.maxExecutionStatisticsPerHandler;
    }

    /**
     * Store settings in localStorage.
     */
    async storeSettings(): Promise<void> {
        await SettingsStore.setItem(
            'objectEventDispatcherStatisticsSettings',
            JSON.stringify({
                enableStatistics: this.enableStatistics,
                enableIOCallStatistics: this.enableIOCallStatistics,
                maxProcessedObjectCount: this.maxProcessedObjectCount,
                retainDeregisteredHandlers: this.retainDeregisteredHandlers,
                maxExecutionStatisticsPerHandler: this.maxExecutionStatisticsPerHandler
            })
        );
    }

    // #### Private stuff ####

    // private reportError(error: any): void {
    //     if (this.onError.listenerCount() > 0) {
    //         this.onError.emit(error);
    //     } else {
    //         console.error('ObjectEventDispatcher: Error during event processing', error);
    //     }
    // }

    private appendToBufferIfNew(
        result: VersionedObjectResult | UnversionedObjectResult | IdObjectResult
    ) {
        if (result.status === 'exists') {
            return;
        }

        const handlers = this.getHandler(result);
        if (this.enableEnqueueFiltering && handlers.length === 0) {
            return;
        }

        deepFreeze(result);

        const priority =
            this.determinePriorityOverride === undefined
                ? ObjectEventDispatcher.determinePriority(result)
                : this.determinePriorityOverride(result);

        this.buffer.add(result, priority);
        this.onGlobalStatisticChanged.emit();
    }

    private async markAsDone(
        _result: VersionedObjectResult | UnversionedObjectResult | IdObjectResult
    ) {
        // TODO: remove it from disk
    }

    private async dispatchHandler<
        T extends UnversionedObjectResult | VersionedObjectResult | IdObjectResult
    >(result: T, handler: HandlerInfo<T>[]): Promise<void> {
        if (this.enableStatistics) {
            const executedHandlerList: GenericBufferHistoryData<T>['handler'] = [];
            const startTime = Date.now();

            for (const h of handler) {
                let error: any;

                if (this.enableIOCallStatistics) {
                    enableStatistics(true, 'ObjectEventDispatcher');
                }

                const handlerStartTime = Date.now();

                try {
                    await h.cb(result);
                } catch (e) {
                    error = e;
                    MessageBus.send('debug', `[OBJECT_EVENTS] Handler failed: ${h.description} - ${e instanceof Error ? e.message : String(e)}`);
                }

                const handlerEndTime = Date.now();

                let ioCallStatistics;
                if (this.enableIOCallStatistics) {
                    enableStatistics(false, 'ObjectEventDispatcher');
                    ioCallStatistics = getStatistics('ObjectEventDispatcher');
                    resetStatistics('ObjectEventDispatcher');
                }

                executedHandlerList.push({
                    info: h,
                    startTime: handlerStartTime,
                    endTime: handlerEndTime,
                    error,
                    ioCallStatistics
                });

                this.pushHandlerExecutionStatistics(h, {
                    startTime: handlerStartTime,
                    endTime: handlerEndTime,
                    idHash: result.idHash || undefined,
                    hash: result.hash || undefined,
                    error,
                    ioCallStatistics
                });

                if (error !== undefined) {
                    this.onError.emit(error);
                }
            }

            const endTime = Date.now();
            this.pushBufferHistoryData({
                result,
                handler: executedHandlerList,
                startTime,
                endTime
            });
        } else {
            for (const h of handler) {
                try {
                    await h.cb(result);
                } catch (e) {
                    MessageBus.send('debug', `[OBJECT_EVENTS] Handler failed: ${h.description} - ${e instanceof Error ? e.message : String(e)}`);
                    this.onError.emit(e);
                }
            }
        }
    }

    private async startDispatchLoop() {
        let resolvePromise: (value: void | PromiseLike<void>) => void = () => {
            // noop
        };

        this.waitForEventLoopDonePromise = new Promise(resolve => {
            resolvePromise = resolve;
        });

        this.stopped = false;
        for (;;) {
            let result: VersionedObjectResult | UnversionedObjectResult | IdObjectResult;

            try {
                result = await this.buffer.remove();
                
                if (this.pausePromise) {
                    await this.pausePromise;
                }

                if (this.stopped) {
                    resolvePromise();
                    break;
                }
            } catch (e) {
                MessageBus.send('debug', `[OBJECT_EVENTS] Error in event loop: ${e instanceof Error ? e.message : String(e)}`);
                resolvePromise();
                break;
            }

            const handlers = this.getHandler(result);
            
            await this.dispatchHandler(result, handlers);
            await this.markAsDone(result);
            ++this.totalExecutionCount;
            this.onGlobalStatisticChanged.emit();

            if (this.stopped) {
                resolvePromise();
                break;
            }
        }
    }

    /**
     * Get handler that are registered for this result.
     *
     * Note: Somehow the as casts are needed, because typescript does not recognize, that a
     * VersionedObjectResult always leads to an Array of HandlerInfo<VersionedObjectResult> and
     * so on for unversioned and Id ...
     * That is why the 'as' casts are needed.
     *
     * This is public by intention. The ui needs it to visualize handlers for pending objects.
     *
     * @param result
     */
    getHandler<T extends VersionedObjectResult | UnversionedObjectResult | IdObjectResult>(
        result: T
    ): HandlerInfo<T>[] {
        if (isVersionedResult(result)) {
            return [
                ...(this.newVersionHandler.get(result.obj.$type$) || []),
                ...(this.newVersionHandler.get(`${result.obj.$type$}+${result.idHash}`) || []),
                ...(this.newVersionHandler.get('*') || [])
            ] as HandlerInfo<T>[];
        } else if (isUnversionedResult(result)) {
            return [
                ...(this.newUnversionedObjectHandler.get(result.obj.$type$) || []),
                ...(this.newUnversionedObjectHandler.get('*') || [])
            ] as HandlerInfo<T>[];
        } else {
            return [
                ...(this.newIdHandler.get(result.obj.$type$) || []),
                ...(this.newIdHandler.get('*') || [])
            ] as HandlerInfo<T>[];
        }
    }

    private pushBufferHistoryData<T extends AnyObjectResult>(data: GenericBufferHistoryData<T>) {
        if (isVersionedResult(data.result)) {
            this.bufferHistory.push({
                type: 'VersionedObject',
                ...(data as unknown as GenericBufferHistoryData<VersionedObjectResult>)
            });
        } else if (isUnversionedResult(data.result)) {
            this.bufferHistory.push({
                type: 'UnversionedObject',
                ...(data as unknown as GenericBufferHistoryData<UnversionedObjectResult>)
            });
        } else {
            this.bufferHistory.push({
                type: 'IdObject',
                ...(data as unknown as GenericBufferHistoryData<IdObjectResult>)
            });
        }

        trimArray(this.bufferHistory, this.maxProcessedObjectCount);
    }

    private pushHandlerExecutionStatistics<T extends AnyObjectResult>(
        h: HandlerInfo<T>,
        statistics: HandlerInfo<T>['executionStatistics'][0]
    ) {
        h.executionStatistics.push(statistics);
        trimArray(h.executionStatistics, this.maxExecutionStatisticsPerHandler);
    }
}

// ######## Utils ########

function deepFreeze(object: any) {
    // Retrieve the property names defined on object
    const propNames = Reflect.ownKeys(object);

    // Freeze properties before freezing self
    for (const name of propNames) {
        const value = object[name];

        if ((value && typeof value === 'object') || typeof value === 'function') {
            deepFreeze(value);
        }
    }

    return Object.freeze(object);
}

function isVersionedResult(
    result: VersionedObjectResult | UnversionedObjectResult | IdObjectResult
): result is VersionedObjectResult {
    if (!Object.hasOwn(result, 'idHash')) {
        return false;
    }

    return Object.hasOwn(result, 'timestamp');
}

function isUnversionedResult(
    result: VersionedObjectResult | UnversionedObjectResult | IdObjectResult
): result is UnversionedObjectResult {
    return Object.hasOwn(result, 'hash');
}

function trimArray<T>(arr: Array<T>, maxSize: number) {
    if (maxSize > -1 && arr.length > maxSize) {
        arr.splice(0, arr.length - maxSize);
    }
}

// TODO Temporary global, until we adjust the architecture
export const objectEvents = new ObjectEventDispatcher();
