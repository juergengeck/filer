import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';
import {Model} from './Model.js';
import type ChannelManager from './ChannelManager.js';
import type {ObjectData, RawChannelEntry} from './ChannelManager.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {AudioExercise} from '../recipes/AudioExerciseRecipes.js';
import type {QueryOptions} from './ChannelManager.js';
import {OEvent} from '../misc/OEvent.js';

export default class AudioExerciseModel extends Model {
    public static readonly channelId = 'audioExercise';

    channelManager: ChannelManager;
    private disconnect: (() => void) | undefined;

    constructor(channelManager: ChannelManager) {
        super();
        this.channelManager = channelManager;
    }

    // @Override base class event
    public onUpdated: OEvent<(timeOfEarliestChange: Date) => void> = new OEvent<
        (timeOfEarliestChange: Date) => void
    >();

    /**
     * Initialize this instance
     */
    async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');

        await this.channelManager.createChannel(AudioExerciseModel.channelId);
        this.disconnect = this.channelManager.onUpdated(this.handleChannelUpdate.bind(this));

        this.state.triggerEvent('init');
    }

    /**
     * Shutdown module
     */
    public async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');
        if (this.disconnect) {
            this.disconnect();
        }
        this.state.triggerEvent('shutdown');
    }

    /**
     * Used to store an audio exercise in one instance.
     * @param audioFileName - the name of the audio file that was played by the user.
     * @param startTimestamp - the time in milliseconds when the user started the audio.
     */
    async addAudioExercise(audioFileName: string, startTimestamp: number): Promise<void> {
        this.state.assertCurrentState('Initialised');

        /** store the audio exercise object in one **/
        await this.channelManager.postToChannel(
            AudioExerciseModel.channelId,
            {
                $type$: 'AudioExercise',
                name: audioFileName
            },
            undefined,
            startTimestamp
        );
    }

    /**
     * Get a list of audio exercises.
     */
    public async audioExercises(): Promise<ObjectData<AudioExercise>[]> {
        this.state.assertCurrentState('Initialised');

        return await this.channelManager.getObjectsWithType('AudioExercise', {
            channelId: AudioExerciseModel.channelId
        });
    }

    /**
     * returns iterator for audio exercises
     * @param queryOptions
     */
    async *audioExercisesIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<AudioExercise>> {
        this.state.assertCurrentState('Initialised');

        yield* this.channelManager.objectIteratorWithType('AudioExercise', {
            ...queryOptions,
            channelId: AudioExerciseModel.channelId
        });
    }

    /**
     * Handler-function for the 'updated' event
     * @param _channelInfoIdHash
     * @param channelId
     * @param _channelOwner
     * @param timeOfEarliestChange
     * @param _data
     */
    private async handleChannelUpdate(
        _channelInfoIdHash: SHA256IdHash<ChannelInfo>,
        channelId: string,
        _channelOwner: SHA256IdHash<Person> | null,
        timeOfEarliestChange: Date,
        _data: RawChannelEntry[]
    ): Promise<void> {
        if (channelId === AudioExerciseModel.channelId) {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }
}
