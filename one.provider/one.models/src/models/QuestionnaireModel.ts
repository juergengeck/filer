import type {ChannelInfo} from '../recipes/ChannelRecipes.js';
import type ChannelManager from './ChannelManager.js';
import type {RawChannelEntry} from './ChannelManager.js';
import type {ObjectData, QueryOptions} from './ChannelManager.js';
import {OEvent} from '../misc/OEvent.js';
import {Model} from './Model.js';

import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

import type {Questionnaire as QuestionnaireRecipe} from '../recipes/QuestionnaireRecipes/QuestionnaireRecipes.js';
import {
    latestQuestionnaireResponsesVersion,
    latestQuestionnaireResponseVersion,
    QuestionnaireResponsesVersions,
    type LatestQuestionnaireResponses,
    type LatestQuestionnaireResponse,
    type LatestQuestionnaireResponseItem
} from '../recipes/QuestionnaireRecipes/QuestionnaireResponseRecipes.js';
import {calculateHashOfObj} from '@refinio/one.core/lib/util/object.js';

// Export the Questionnaire types
export type Questionnaire = Omit<QuestionnaireRecipe, '$type$'>;
export type Question = QuestionnaireRecipe.Question;
export type QuestionnaireExtension = QuestionnaireRecipe.Extension;
export type QuestionnaireMinValueExtension = QuestionnaireRecipe.ExtensionMinValue;
export type QuestionnaireMaxValueExtension = QuestionnaireRecipe.ExtensionMaxValue;
export type QuestionnaireMinLengthExtension = QuestionnaireRecipe.ExtensionMinLength;
export type QuestionnaireRegexExtension = QuestionnaireRecipe.ExtensionRegEx;
export type QuestionnaireDesignNoteExtension = QuestionnaireRecipe.ExtensionDesignNote;
export type QuestionnaireEntryFormatExtension = QuestionnaireRecipe.ExtensionEntryFormat;
export type Coding = QuestionnaireRecipe.Coding;
export type QuestionnaireEnableWhenAnswer = QuestionnaireRecipe.QuestionnaireEnableWhenAnswer;
export type QuestionnaireAnswerOptionValue = QuestionnaireRecipe.QuestionnaireEnableWhenAnswer;
export type QuestionnaireValue = QuestionnaireRecipe.QuestionnaireValue;
export type QuestionnaireResponses = LatestQuestionnaireResponses;
export type QuestionnaireResponse = LatestQuestionnaireResponse;
export type QuestionnaireResponseItem = LatestQuestionnaireResponseItem;
export const questionnaireResponsesType = latestQuestionnaireResponsesVersion;
export const questionnaireResponsesTypes = QuestionnaireResponsesVersions;
export const questionnaireResponseType = latestQuestionnaireResponseVersion;

/**
 * This model represents everything related to Questionnaires.
 *
 * At the moment this model is just managing questionnaire responses.
 * In the future this will most probably also manage questionnaires.
 */
export default class QuestionnaireModel extends Model {
    /**
     * Event is emitted when the incomplete questionnaire response data is updated.
     */
    public onIncompleteResponse = new OEvent<() => void>();

    /**
     * Event is emitted when the questionnaire response data is updated.
     */

    private channelManager: ChannelManager;
    public static readonly channelId = 'questionnaireResponse';
    private readonly availableQuestionnaires: Questionnaire[];
    private readonly incompleteResponsesChannelId: string;
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
        this.availableQuestionnaires = [];
        this.incompleteResponsesChannelId = 'incompleteQuestionnaireResponse';
    }

    /**
     * Initialize this instance
     *
     * This must be done after the one instance was initialized.
     */
    public async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');
        this.state.triggerEvent('init');

        await this.channelManager.createChannel(QuestionnaireModel.channelId);
        await this.channelManager.createChannel(this.incompleteResponsesChannelId);
        this.disconnect = this.channelManager.onUpdated(this.handleOnUpdated.bind(this));
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

    // #### Questionnaire functions ####

    /**
     * Get a list of available questionnaires
     */
    public async questionnaires(): Promise<Questionnaire[]> {
        this.state.assertCurrentState('Initialised');

        return this.availableQuestionnaires;
    }

    /**
     * Get a specific questionnaire
     *
     * Note that this does not connect to the server behind the url. The url is
     * simply the id used by questionnaires. FHIR uses urls for identifying resources
     * such as questionnaires.
     *
     * @param url - The url of the questionnaire
     */
    public async questionnaireByUrl(url: string): Promise<Questionnaire> {
        this.state.assertCurrentState('Initialised');

        for (const questionnaire of this.availableQuestionnaires) {
            if (questionnaire.url === url) {
                return questionnaire;
            }
        }
        throw Error('Questionnaire with url ' + url + ' does not exist');
    }

    /**
     * Get a specific questionnaire
     *
     * @param name - The name of the questionnaire
     * @param language - Language of questionnaire. If empty, just return the first in any language.
     */
    public async questionnaireByName(name: string, language?: string): Promise<Questionnaire> {
        this.state.assertCurrentState('Initialised');

        for (const questionnaire of this.availableQuestionnaires) {
            if (questionnaire.name === name && (!language || questionnaire.language === language)) {
                return questionnaire;
            }
        }
        throw Error(
            // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
            'Questionnaire with name ' + name + ' and language ' + language + ' does not exist'
        );
    }

    /**
     * Get a questionnaire url by name and language.
     *
     * @param name
     * @param language
     */
    public async questionnaireUrlByName(name: string, language?: string): Promise<string> {
        this.state.assertCurrentState('Initialised');

        for (const questionnaire of this.availableQuestionnaires) {
            if (
                questionnaire.name === name &&
                (!language || questionnaire.language === language) &&
                questionnaire.url
            ) {
                return questionnaire.url;
            }
        }
        throw Error(
            // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
            'Questionnaire with name ' + name + ' and language ' + language + ' does not exist'
        );
    }

    /**
     * Checks whether a questionnaire exists.
     *
     * @param url - Url of the questionnaire
     */
    public async hasQuestionnaireWithUrl(url: string): Promise<boolean> {
        this.state.assertCurrentState('Initialised');

        for (const questionnaire of this.availableQuestionnaires) {
            if (questionnaire.url === url) {
                return true;
            }
        }
        return false;
    }

    /**
     * Checks whether a questionnaire exists.
     *
     * @param name - Name of the questionnaire
     * @param language - Language of questionnaire. If empty, just check in any language.
     */
    public async hasQuestionnaireWithName(name: string, language?: string): Promise<boolean> {
        this.state.assertCurrentState('Initialised');

        for (const questionnaire of this.availableQuestionnaires) {
            if (questionnaire.name === name && (!language || questionnaire.language === language)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Adding questionnaires to the available questionnaires list.
     *
     * Note: In the future questionnaires will be served by one as one objects.
     *       This function will then change or be removed.
     *
     * @param questionnaires - The list of the questionnaires that will be added
     */
    public registerQuestionnaires(questionnaires: Questionnaire[]): void {
        this.state.assertCurrentState('Initialised');

        this.availableQuestionnaires.push(...questionnaires);
    }

    // #### Questionnaire response functions ####

    /**
     * Create a new response to a questionnaire
     *
     * @param response - The questionnaire response to post
     * @param name - The name for this collection. This could be something the user specifies in order to be identified easily.
     * @param type - An application specific type. It is up to the application what to do with it.
     * @param owner - Change the owner of the channel to post to. Defaults to the default channel person that is set in the channel manager.
     */
    public async postResponse(
        response: QuestionnaireResponse,
        name?: string,
        type?: string,
        owner?: SHA256IdHash<Person>
    ): Promise<SHA256Hash<QuestionnaireResponses>> {
        this.state.assertCurrentState('Initialised');

        return await this.postResponseCollection([response], name, type, owner);
    }

    /**
     * Post multiple responses as a single collection.
     *
     * This means that later when querying the questionnaires, this collection will appear as single entry.
     * This is useful if you dynamically compose a big questionnaires from several partial questionnaires.
     *
     * @param responses - The list of questionnaire responses to post
     * @param name - The name for this collection. This could be something the user specifies in order to be identified easily.
     * @param type - An application specific type. It is up to the application what to do with it.
     * @param owner - Change the owner of the channel to post to. Defaults to the default channel person that is set in the channel manager.
     */
    public async postResponseCollection(
        responses: QuestionnaireResponse[],
        name?: string,
        type?: string,
        owner?: SHA256IdHash<Person>
    ): Promise<SHA256Hash<QuestionnaireResponses>> {
        this.state.assertCurrentState('Initialised');

        // We decided not to do any validation here, because it is done by the questionnaire builder.
        // If you post something wrong, then shame on you :-)

        // Create channel if owner is not the default owner.
        if (
            owner !== undefined &&
            (await this.channelManager.hasChannel(QuestionnaireModel.channelId, owner))
        ) {
            await this.channelManager.createChannel(QuestionnaireModel.channelId, owner);
        }

        // Post the result to the one instance
        await this.channelManager.postToChannel(
            QuestionnaireModel.channelId,
            {
                $type$: questionnaireResponsesType,
                name,
                type,
                response: responses
            },
            owner
        );

        return calculateHashOfObj({
            $type$: questionnaireResponsesType,
            name,
            type,
            response: responses
        });
    }

    /**
     * Get a list of responses.
     */
    public async responses(): Promise<ObjectData<QuestionnaireResponses>[]> {
        this.state.assertCurrentState('Initialised');

        return this.channelManager.getObjects({
            // QuestionnaireResponses is intentionally cast into QuestionnaireResponses_2_0_0
            // QuestionnaireResponses_2_0_0 only has additions
            types: questionnaireResponsesTypes,
            channelId: QuestionnaireModel.channelId
        }) as unknown as ObjectData<QuestionnaireResponses>[];
    }

    /**
     * returns iterator for QuestionnaireResponses
     * @param queryOptions
     */
    async *responsesIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<QuestionnaireResponses>> {
        this.state.assertCurrentState('Initialised');

        yield* this.channelManager.objectIterator({
            ...queryOptions,
            // QuestionnaireResponses is intentionally cast into QuestionnaireResponses_2_0_0
            // QuestionnaireResponses_2_0_0 only has additions
            types: questionnaireResponsesTypes,
            channelId: QuestionnaireModel.channelId
        }) as unknown as AsyncIterableIterator<ObjectData<LatestQuestionnaireResponses>>;
    }

    /**
     * Get a specific questionnaire response
     *
     * @param id - the id of the questionnaire response. It is the id field of the ObjectData.
     */
    public async responsesById(id: string): Promise<ObjectData<QuestionnaireResponses>> {
        this.state.assertCurrentState('Initialised');

        const iterator = this.channelManager.objectIterator({
            // QuestionnaireResponses is intentionally cast into QuestionnaireResponses_2_0_0
            // QuestionnaireResponses_2_0_0 only has additions
            types: questionnaireResponsesTypes,
            channelId: QuestionnaireModel.channelId,
            id
        }) as unknown as AsyncIterableIterator<ObjectData<LatestQuestionnaireResponses>>;

        for await (const responses of iterator) {
            return responses;
        }

        throw new Error('The referenced object does not exist');
    }

    // ######### Incomplete Response Methods ########

    /**
     * Saving incomplete questionnaires.
     *
     * @param response - The incomplete response.
     * @param type - The type of the response. This is later used to find incomplete responses.
     * @param name - The name of the response
     */
    public async postIncompleteResponse(
        response: QuestionnaireResponse,
        type: string,
        name?: string
    ): Promise<void> {
        this.state.assertCurrentState('Initialised');

        await this.postIncompleteResponseCollection([response], type, name);
    }

    /**
     * Save incomplete questionnaire collection.
     *
     * @param responses - The response list. If this list is empty then it works exactly as markIncompleteResponseAsComplete.
     * @param type - The type of the response. This is later used to find incomplete responses.
     * @param name - The name of the response
     */
    public async postIncompleteResponseCollection(
        responses: QuestionnaireResponse[],
        type: string,
        name?: string
    ): Promise<void> {
        this.state.assertCurrentState('Initialised');

        // Post the result to the one instance
        await this.channelManager.postToChannel(this.incompleteResponsesChannelId, {
            $type$: questionnaireResponsesType,
            name,
            type,
            response: responses
        });
    }

    /**
     * Getting the latest incomplete questionnaire.
     *
     * @param type - type of incomplete response collection
     * @param since - not older than this date.
     * @returns the incomplete data, or null if there isn't such data.
     */
    public async incompleteResponse(
        type: string,
        since?: Date
    ): Promise<ObjectData<QuestionnaireResponses> | null> {
        this.state.assertCurrentState('Initialised');

        // Construct iterator
        const iterator = this.channelManager.objectIterator({
            // QuestionnaireResponses is intentionally cast into QuestionnaireResponses_2_0_0
            // QuestionnaireResponses_2_0_0 only has additions
            types: questionnaireResponsesTypes,
            channelId: this.incompleteResponsesChannelId,
            from: since
        }) as unknown as AsyncIterableIterator<ObjectData<LatestQuestionnaireResponses>>;

        // Iterate over all entries and see if a type is present
        for await (const responses of iterator) {
            if (responses.data.type !== type) {
                continue;
            }

            // Check if an empty element is found => no incomplete entry
            if (responses.data.response.length === 0) {
                return null;
            }

            return responses;
        }
        return null;
    }

    /**
     * Check if incomplete questionnaires exists.
     *
     * @param type - The type of the incomplete response collection.
     * @param since - Not older than this date.
     * @returns
     */
    public async hasIncompleteResponse(type: string, since?: Date): Promise<boolean> {
        this.state.assertCurrentState('Initialised');

        return (await this.incompleteResponse(type, since)) !== null;
    }

    /**
     * Marks an incomplete response as complete.
     *
     * Note: This simply posts an empty responses object to the incomplete channel.
     *
     * @param type - The type of the incomplete response collection.
     */
    public async markIncompleteResponseAsComplete(type: string): Promise<void> {
        this.state.assertCurrentState('Initialised');

        await this.channelManager.postToChannel(this.incompleteResponsesChannelId, {
            $type$: questionnaireResponsesType,
            type: type,
            response: []
        });
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
        this.state.assertCurrentState('Initialised');

        if (
            channelId === QuestionnaireModel.channelId ||
            channelId === this.incompleteResponsesChannelId
        ) {
            this.onUpdated.emit(timeOfEarliestChange);
            if (channelId === this.incompleteResponsesChannelId) {
                this.onIncompleteResponse.emit();
            }
        }
    }
}
