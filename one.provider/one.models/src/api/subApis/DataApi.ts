import type {BLOB, OneVersionedObjectTypes} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getCurrentVersion, getVersionNodeByNodeHash, getVersionsNodeHashes} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {readBlobAsArrayBuffer} from '@refinio/one.core/lib/storage-blob.js';

import type {DataApiType, ModelsHelperType, OneApi} from '../utils/types.js';
import {objectEvents} from '../../misc/ObjectEventDispatcher.js';
import type {BlobDescriptor} from '../../recipes/BlobRecipes.js';

export default class DataApi implements DataApiType {
    private oneApi: OneApi;
    private models: ModelsHelperType;

    constructor(oneApi: OneApi, models: ModelsHelperType) {
        this.oneApi = oneApi;
        this.models = models;
    }

    /**
     * @param idHash - id hash of the data to be observed
     * @returns all current versions of the data
     */
    async getAllVersions<T extends OneVersionedObjectTypes>(
        idHash: SHA256IdHash<T>
    ): Promise<T[]> {
        const data: T[] = [];

        const versionNodeHashes = await getVersionsNodeHashes(idHash);
        if (versionNodeHashes === undefined) {
            return data;
        }

        for (const versionNodeHash of versionNodeHashes) {
            const node = await getVersionNodeByNodeHash(versionNodeHash);
            data.push(await getObject(node.obj.data) as T);
        }

        return data;
    }

    /**
     * @param idHash - id hash of the data to be observed
     * @param onUpdate - function to be called when the data changes
     * @returns disconnect listener function
     */
    async useLiveAllVersions<T extends OneVersionedObjectTypes>(
        idHash: SHA256IdHash<T>,
        onUpdate: (data: T[]) => void | Promise<void>
    ): Promise<() => void> {
        const data = await this.getAllVersions(idHash);
        await onUpdate(data);
        return objectEvents.onNewVersion(
            async result => {
                if (result.idHash !== idHash) {
                    return;
                }
                data.push(result.obj as T);
                await onUpdate(data);
            },
            'useLiveAllVersions ' + idHash,
            '*',
            idHash
        );
    }

    /**
     * @param idHash - id hash of the data to be observed
     * @returns the latest version of the data
     */
    async getLatestVersion<T extends OneVersionedObjectTypes>(idHash: SHA256IdHash<T>): Promise<T> {
        return await getCurrentVersion(idHash);
    }

    /**
     * @param idHash - id hash of the data to be observed
     * @param onUpdate - function to be called when the data changes
     * @returns disconnect listener function
     */
    async useLiveLatestVersion<T extends OneVersionedObjectTypes>(
        idHash: SHA256IdHash<T>,
        onUpdate: (data: T) => void | Promise<void>
    ): Promise<() => void> {
        await onUpdate(await this.getLatestVersion(idHash));
        return objectEvents.onNewVersion(
            async result => {
                if (result.idHash !== idHash) {
                    return;
                }
                await onUpdate(result.obj as T);
            },
            'getLiveLatestVersion ' + idHash,
            '*',
            idHash
        );
    }

    /**
     * @param hash - hash of the blob to be observed
     * @returns the blob as an array buffer
     */
    async getBlobAsArrayBuffer(hash: SHA256Hash<BLOB>): Promise<ArrayBuffer> {
        return await readBlobAsArrayBuffer(hash);
    }

    /**
     * @param hash - hash of the blob to be observed
     * @returns the blob as a URL
     */
    async getBlobURL(hash: SHA256Hash<BLOB>): Promise<string> {
        return URL.createObjectURL(new Blob([await this.getBlobAsArrayBuffer(hash)]));
    }

    /**
     * @param hash - hash of the blob descriptor to be observed
     * @returns the blob descriptor as an array buffer
     */
    async getBlobDescriptorAsArrayBuffer(hash: SHA256Hash<BlobDescriptor>): Promise<ArrayBuffer> {
        const blobDescriptor = await getObject(hash);
        const object = await getObject(hash);
        return await this.getBlobAsArrayBuffer(object.data);
    }

    /**
     * @param hash - hash of the blob descriptor to be observed
     * @returns the blob descriptor as a URL
     */
    async getBlobDescriptorUrl(hash: SHA256Hash<BlobDescriptor>): Promise<string> {
        return URL.createObjectURL(new Blob([await this.getBlobDescriptorAsArrayBuffer(hash)]));
    }
}
