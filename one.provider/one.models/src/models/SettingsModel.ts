import {
    getObjectByIdObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import type {Settings as OneSettings} from '../recipes/SettingsRecipe.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {objectEvents} from '../misc/ObjectEventDispatcher.js';
import {OEvent} from '../misc/OEvent.js';

// -------- LOW LEVEL API -----------

export type Settings = {
    id: string; // id value
    properties: Map<string, string>;
};

export abstract class PropertyTree {
    /**
     * Event is emitted when the settings are updated.
     */
    public onSettingChange = new OEvent<(key: string, value: string | undefined) => void>();
    proxyInstances: Map<string, PropertyTreeProxy> = new Map<string, PropertyTreeProxy>();

    abstract setValue(key: string, value: string): Promise<void>;
    abstract getValue(key: string): string;
    abstract getChild(key: string): PropertyTree;
    abstract hasValue(key: string): boolean;
    abstract init(): Promise<void>;
}

export class PropertyTreeProxy extends PropertyTree {
    prefix: string;
    separator: string;
    parent: PropertyTree;

    async init(): Promise<void> {
        /*...*/
    }

    constructor(prefix: string, separator: string, parent: PropertyTree) {
        super();
        this.prefix = prefix;
        this.separator = separator;
        this.parent = parent;

        this.parent.onSettingChange((key, value) => {
            // strip prefix from key
            const keys = key.split(separator);
            const strippedKey = keys[keys.length - 1];
            this.onSettingChange.emit(strippedKey, value);
        });
    }

    async setValue(key: string, value: string): Promise<void> {
        await this.parent.setValue(this.prefix + this.separator + key, value);
    }

    getValue(key: string): string {
        return this.parent.getValue(this.prefix + this.separator + key);
    }

    getChild(key: string): PropertyTree {
        let proxyInstance = this.proxyInstances.get(key);

        if (proxyInstance === undefined) {
            proxyInstance = new PropertyTreeProxy(key, this.separator, this);
            this.proxyInstances.set(key, proxyInstance);
        }

        return proxyInstance;
    }

    hasValue(key: string): boolean {
        return this.parent.getValue(this.prefix + this.separator + key) !== '';
    }
}

export default class PropertyTreeStore extends PropertyTree {
    oneId: string;
    separator: string;
    keyValueStore: Map<string, string> = new Map<string, string>();

    async init(): Promise<void> {
        try {
            const oneKeyValueStore = await getObjectByIdObj({
                $type$: 'Settings',
                id: this.oneId
            });
            await this.storageUpdated(oneKeyValueStore.obj);
        } catch (_) {
            this.keyValueStore = new Map<string, string>();
        }
    }

    constructor(oneId: string, separator = '.') {
        super();
        this.oneId = oneId;
        this.separator = separator;
        // register storageUpdated hook at one storage
        objectEvents.onNewVersion(
            async caughtObject => {
                await this.storageUpdated(caughtObject.obj);
            },
            'PropertyTreeStore: storageUpdated',
            'Settings'
        );
    }

    // one hook for changed settings object
    private async storageUpdated(oneSettings: OneSettings): Promise<void> {
        // or: if map was empty then emit only a single event with empty key
        if (this.keyValueStore.size === 0) {
            this.keyValueStore = new Map<string, string>(oneSettings.properties);
            await this.onSettingChange.emitAll('', undefined);
        } else {
            // diff the oneSettings with the keyValueStore
            for (const [key, value] of oneSettings.properties.entries()) {
                if (value !== this.keyValueStore.get(key)) {
                    // update the keyValueStore with changes
                    this.keyValueStore.set(key, value);
                    // emit only the remembered changes
                    this.onSettingChange.emit(key, value);
                }
            }
        }
    }

    async setValue(key: string, value: string): Promise<void> {
        // --- option 1: --- // Lets this try first!
        // copy keyValueStore
        const idHashOfKeyValueStore = await calculateIdHashOfObj({
            $type$: 'Settings',
            id: this.oneId
        });

        await serializeWithType(idHashOfKeyValueStore, async () => {
            const keyValueStoreCopy: Map<string, string> = new Map<string, string>(
                this.keyValueStore
            );
            // change the value
            keyValueStoreCopy.set(key, value);
            // store the object in instance
            await storeVersionedObject({
                $type$: 'Settings',
                id: this.oneId,
                properties: keyValueStoreCopy
            });
        });
    }

    getValue(key: string): string {
        const value = this.keyValueStore.get(key);

        if (value !== undefined) {
            return value;
        }

        return '';
    }

    getChild(key: string): PropertyTree {
        let proxyInstance = this.proxyInstances.get(key);

        if (proxyInstance === undefined) {
            proxyInstance = new PropertyTreeProxy(key, this.separator, this);
            this.proxyInstances.set(key, proxyInstance);
        }

        return proxyInstance;
    }

    hasValue(key: string): boolean {
        return this.keyValueStore.get(key) !== '';
    }
}
