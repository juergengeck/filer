import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';
import type ChannelManager from './ChannelManager.js';
import type {ObjectData, QueryOptions, RawChannelEntry} from './ChannelManager.js';
import type {DiaryEntry as OneDiaryEntry} from '../recipes/DiaryRecipes.js';
import {Model} from './Model.js';

import type {Person} from '@refinio/one.core/lib/recipes.js';
import {OEvent} from '../misc/OEvent.js';

/**
 * This represents the model of a diary entry
 */
export type DiaryEntry = string;

/**
 * Convert from model representation to one representation.
 *
 * @param modelObject - the model object
 * @returns The corresponding one object
 */
function convertToOne(modelObject: DiaryEntry): OneDiaryEntry {
    // Create the resulting object
    return {
        $type$: 'DiaryEntry',
        entry: modelObject
    };
}

/**
 * Convert from one representation to model representation.
 *
 * @param oneObject - the one object
 * @returns The corresponding model object
 */
function convertFromOne(oneObject: OneDiaryEntry): DiaryEntry {
    // Create the new ObjectData item
    return oneObject.entry;
}

/**
 * This model implements the possibility of adding a diary entry into a journal and
 * keeping track of the list of the diary entries
 */
export default class DiaryModel extends Model {
    channelManager: ChannelManager;
    public static readonly channelId = 'diary';
    private disconnect: (() => void) | undefined;

    // @Override base class event
    public onUpdated: OEvent<(timeOfEarliestChange: Date) => void> = new OEvent<
        (timeOfEarliestChange: Date) => void
    >();

    /**
     * Construct a new instance
     *
     * @param channelManager - The channel manager instance
     */
    constructor(channelManager: ChannelManager) {
        super();

        this.channelManager = channelManager;
    }

    /**
     * Check if the model is initialized
     * @returns true if the model is initialized, false otherwise
     */
    public isInitialized(): boolean {
        return this.state.currentState === 'Initialised';
    }

    /**
     * Initialize this instance
     *
     * This must be done after the one instance was initialized.
     */
    async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');

        await this.channelManager.createChannel(DiaryModel.channelId);
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

    async addEntry(diaryEntry: DiaryEntry, owner?: SHA256IdHash<Person>): Promise<void> {
        this.state.assertCurrentState('Initialised');

        if (!diaryEntry) {
            throw Error('Diary entry is empty');
        }
        await this.channelManager.postToChannel(
            DiaryModel.channelId,
            convertToOne(diaryEntry),
            owner
        );
    }

    async entries(): Promise<ObjectData<DiaryEntry>[]> {
        this.state.assertCurrentState('Initialised');

        const objects: ObjectData<DiaryEntry>[] = [];
        const oneObjects = await this.channelManager.getObjectsWithType('DiaryEntry', {
            channelId: DiaryModel.channelId
        });

        // Convert the data member from one to model representation
        for (const oneObject of oneObjects) {
            const {data, ...restObjectData} = oneObject;
            objects.push({...restObjectData, data: convertFromOne(data)});
        }

        return objects;
    }

    /**
     * returns iterator for Diary Entries
     * @param queryOptions
     */
    async *entriesIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<OneDiaryEntry>> {
        this.state.assertCurrentState('Initialised');

        for await (const entry of this.channelManager.objectIteratorWithType('DiaryEntry', {
            ...queryOptions,
            channelId: DiaryModel.channelId
        })) {
            yield entry;
        }
    }

    async getEntryById(id: string): Promise<ObjectData<DiaryEntry>> {
        this.state.assertCurrentState('Initialised');

        const {data, ...restObjectData} = await this.channelManager.getObjectWithTypeById(
            id,
            'DiaryEntry'
        );
        return {...restObjectData, data: convertFromOne(data)};
    }

    /**
     *  Handler function for the 'updated' event
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
        if (channelId === DiaryModel.channelId) {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }
}
