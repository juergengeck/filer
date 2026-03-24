import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {OneObjectTypes} from '@refinio/one.core/lib/recipes.js';
import {getObjectWithType} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {OEvent} from '../../../misc/OEvent.js';

/**
 * This cache caches objects so that they can be accessed faster and synchronously later.
 */
export default class OneObjectCache<T extends OneObjectTypes> {
    public onUpdate = new OEvent<(objHash: SHA256Hash<T>, obj: T) => void>();
    public onError = new OEvent<(error: any) => void>();

    private isInitialized = true;
    private cache = new Map<SHA256Hash<T>, T>();
    private runtimeCheckTypes: T['$type$'][];

    constructor(runtimeCheckTypes: T['$type$'][]) {
        this.runtimeCheckTypes = runtimeCheckTypes;
    }

    /**
     * Cleanup the instance.
     *
     * After this function is called this class cannot be reused.
     */
    public shutdown() {
        this.isInitialized = false;
        this.cache.clear();
    }

    /**
     * Load the object and put it in the cache.
     *
     * After successful loading the onUpdate event is emitted.
     *
     * @param objHash - Hash of object to load.
     */
    public loadObjectIntoCache(objHash: SHA256Hash<T>) {
        this.assertInitialized();
        this.queryOrLoadObjectIntoCache(objHash).catch(e => this.onError.emit(e));
    }

    /**
     * Same as loadObjectIntoCache, except that it does a runtime check on $type$ field.
     *
     * The runtime check is done against the values passed in the constructor. If the runtime check fails the onError
     * event will fire.
     *
     * @param objHash
     */
    public loadObjectIntoCacheWithRuntimeCheck(objHash: SHA256Hash) {
        this.assertInitialized();
        this.queryOrLoadObjectIntoCacheWithRuntimeCheck(objHash).catch(e => this.onError.emit(e));
    }

    /**
     * Load the object or query it from cache if it was loaded previously.
     *
     * @param objHash
     */
    public async queryOrLoadObjectIntoCache(objHash: SHA256Hash<T>): Promise<T> {
        this.assertInitialized();

        const cachedObj = this.cache.get(objHash);
        if (cachedObj !== undefined) {
            return cachedObj;
        }

        const obj = await getObjectWithType<T>(objHash);
        this.cache.set(objHash, obj);
        this.onUpdate.emit(objHash, obj);
        return obj;
    }

    /**
     * Same as queryOrLoadObjectIntoCache, except that it does a runtime check on $type$ field.
     *
     * The runtime check is done against the values passed inthe constructor. If the runtime check fails the promise
     * will reject.
     *
     * @param objHash
     */
    public async queryOrLoadObjectIntoCacheWithRuntimeCheck(objHash: SHA256Hash): Promise<T> {
        this.assertInitialized();
        const objHashOfExpectedType = objHash as SHA256Hash<T>;

        const cachedObj = this.cache.get(objHashOfExpectedType);
        if (cachedObj !== undefined) {
            return cachedObj;
        }

        const obj = await getObjectWithType<T>(objHashOfExpectedType);
        if (!this.runtimeCheckTypes.includes(obj.$type$)) {
            throw new Error(
                `The requested object is not of expected type '${this.runtimeCheckTypes.join(
                    '|'
                )}', but of type '${obj.$type$}'. Skipping.`
            );
        }
        this.cache.set(objHashOfExpectedType, obj);
        this.onUpdate.emit(objHashOfExpectedType, obj);
        return obj;
    }

    /**
     * Get the object from the cache or undefined if it is not cached.
     *
     * @param objHash
     */
    public queryObject(objHash: SHA256Hash<T>): T | undefined {
        this.assertInitialized();
        return this.cache.get(objHash);
    }

    private assertInitialized() {
        if (!this.isInitialized) {
            throw new Error(
                'OneObjectCache: You cannot use any method of this class, because it is already shut down.'
            );
        }
    }
}
