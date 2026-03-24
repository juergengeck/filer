import type {
    BlobCollection as OneBlobCollection,
    BlobDescriptor as OneBlobDescriptor
} from '../recipes/BlobRecipes.js';
import type ChannelManager from './ChannelManager.js';
import {Model} from './Model.js';

import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {
    getObject,
    storeUnversionedObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {createFileWriteStream} from '@refinio/one.core/lib/system/storage-streams.js';
import {readBlobAsArrayBuffer} from '@refinio/one.core/lib/storage-blob.js';
import {OEvent} from '../misc/OEvent.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';
import type {RawChannelEntry} from './ChannelManager.js';

export interface BlobDescriptor {
    data: ArrayBuffer;
    lastModified: number;
    name: string;
    size: number;
    type: string;
}

export interface BlobCollection {
    name: string;
    blobs: BlobDescriptor[];
}

/**
 * This class handles storing and retrieving of blob collections.
 * All get methods are set to only use the ownerChannel
 *
 * Multiple files:
 * Storing: call addCollections with an array of files and a name.
 * Loading: call getCollection(name)
 *
 * Single file:
 * Storing: call addCollections with an array of files containing one element and a name.
 * Loading: call getCollection(name)[0]
 */
export default class BlobCollectionModel extends Model {
    private channelManager: ChannelManager;
    private channelOwner: SHA256IdHash<Person> | undefined;
    public static readonly channelId = 'blobCollections';
    private disconnect: (() => void) | undefined;

    // @Override base class event
    public onUpdated: OEvent<(timeOfEarliestChange: Date) => void> = new OEvent<
        (timeOfEarliestChange: Date) => void
    >();

    constructor(channelManager: ChannelManager) {
        super();

        this.channelManager = channelManager;
    }

    /**
     * allows to set the channel owner so that not all channels of all owners will be loaded
     * @param channelOwner
     */
    setChannelOwner(channelOwner: SHA256IdHash<Person>): void {
        this.channelOwner = channelOwner;
    }

    /**
     * Used to init the model to receive the updates.
     */
    async init() {
        this.state.assertCurrentState('Uninitialised');

        await this.channelManager.createChannel(BlobCollectionModel.channelId);
        this.disconnect = this.channelManager.onUpdated(this.handleOnUpdated.bind(this));

        this.state.triggerEvent('init');
    }

    /**
     * Shutdown module
     */
    async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        if (this.disconnect) {
            this.disconnect();
        }
        this.state.triggerEvent('shutdown');
    }

    async addCollection(files: File[], name: OneBlobCollection['name']): Promise<void> {
        this.state.assertCurrentState('Initialised');

        const blobCollection = await BlobCollectionModel.createBlobCollection(files, name);

        await this.channelManager.postToChannel(BlobCollectionModel.channelId, blobCollection.obj);
    }

    private static async createBlobCollection(
        files: File[],
        collectionName: string
    ): Promise<UnversionedObjectResult<OneBlobCollection>> {
        const blobs: UnversionedObjectResult<OneBlobDescriptor>[] = [];

        for (const file of files) {
            const stream = createFileWriteStream();
            stream.write(await file.arrayBuffer());
            const blob = await stream.end();

            const {lastModified, name, size, type} = file;

            const blobDescriptor: OneBlobDescriptor = {
                $type$: 'BlobDescriptor',
                data: blob.hash,
                lastModified,
                name,
                size,
                type
            };
            blobs.push(await storeUnversionedObject(blobDescriptor));
        }

        const blobCollection: OneBlobCollection = {
            $type$: 'BlobCollection',
            blobs: blobs.map(
                (blobResult: UnversionedObjectResult<OneBlobDescriptor>) => blobResult.hash
            ),
            name: collectionName
        };

        return storeUnversionedObject(blobCollection);
    }

    async getCollection(name: OneBlobCollection['name']): Promise<BlobCollection> {
        this.state.assertCurrentState('Initialised');

        const collections = await this.channelManager.getObjectsWithType('BlobCollection', {
            owner: this.channelOwner,
            channelId: BlobCollectionModel.channelId
        });
        const collection = collections.find(objectData => objectData.data.name === name);
        if (collection) {
            return this.resolveBlobCollection(collection.data);
        } else {
            throw new Error(`BlobCollection ${name} not found.`);
        }
    }

    async getLatestCollection(): Promise<BlobCollection> {
        this.state.assertCurrentState('Initialised');

        const collection = await this.channelManager.getObjectsWithType('BlobCollection', {
            channelId: BlobCollectionModel.channelId,
            count: 1,
            owner: this.channelOwner
        });
        if (collection && collection.length > 0) {
            return this.resolveBlobCollection(collection[0].data);
        } else {
            throw new Error('No BlobCollection found in channel');
        }
    }

    /**
     * Handler function for the 'updated' event
     * @param _channelInfoIdHash
     * @param channelId
     * @param _channelOwner
     * @param timeOfEarliestChange
     * @param _data
     */
    private async handleOnUpdated(
        _channelInfoIdHash: SHA256IdHash<ChannelInfo>,
        channelId: string,
        _channelOwner: SHA256IdHash<Person> | null,
        timeOfEarliestChange: Date,
        _data: RawChannelEntry[]
    ): Promise<void> {
        if (channelId === BlobCollectionModel.channelId) {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }

    /**
     * Resolves the OneBlobCollection.blobs hash references to the actual ONE objects
     * @param blobCollection
     * @return
     * @private
     */
    private async resolveBlobCollection(
        blobCollection: OneBlobCollection
    ): Promise<BlobCollection> {
        const blobDescriptors = await Promise.all(
            blobCollection.blobs.map(hash => getObject(hash))
        );
        const resolvedBlobDescriptors = await Promise.all(
            blobDescriptors.map(blobDescriptor =>
                BlobCollectionModel.resolveBlobDescriptor(blobDescriptor)
            )
        );
        return {...blobCollection, blobs: resolvedBlobDescriptors};
    }

    /**
     * Resolves the OneBlobDescriptor.data blob reference to tha actual ArrayBuffer data
     * @param blobDescriptor
     * @return
     * @private
     */
    public static async resolveBlobDescriptor(
        blobDescriptor: OneBlobDescriptor
    ): Promise<BlobDescriptor> {
        const blobData = await readBlobAsArrayBuffer(blobDescriptor.data);

        return {...blobDescriptor, data: blobData};
    }
}
