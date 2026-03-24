import ChatApi from './subApis/ChatApi.js';
import type {OneApi, OneApiCreateConfig, OneApiInitConfig} from './utils/types.js';
import Models from './utils/Models.js';
import LeuteApi from './subApis/LeuteApi.js';
import DataApi from './subApis/DataApi.js';
import InternetOfPeopleApi from './subApis/InternetOfPeopleApi.js';
import InternetOfMeApi from './subApis/InternetOfMeApi.js';
import TrustApi from './subApis/TrustApi.js';
import AIApi from './subApis/AIApi.js';

export default class One implements OneApi {
    private api: {
        chatApi?: ChatApi;
        leuteApi?: LeuteApi;
        dataApi?: DataApi;
        internetOfPeopleApi?: InternetOfPeopleApi;
        internetOfMeApi?: InternetOfMeApi;
        trustApi?: TrustApi;
        aiApi?: AIApi;
    } = {};
    private models: Models;

    /**
     * Constructor for the One API
     * @param config - The configuration for the One API
     */
    constructor(config: OneApiCreateConfig) {
        // Setup models
        this.models = new Models(
            config.commServerUrl,
            config.externalModels,
            config.connectionsModelConfig
        );
    }

    /**
     * Initialize the One API
     */
    async init(config?: OneApiInitConfig) {
        // Initialize models
        await this.models.init(config);

        // Initialize APIs
        for (const api of Object.values(this.api)) {
            if (hasInitMethod(api)) {
                await api.init(config);
            }
        }
    }

    /**
     * Shutdown the One API
     */
    async shutdown(): Promise<void> {
        this.models.state.assertCurrentState('Initialised');
        for (const api of Object.values(this.api)) {
            if (hasShutdownMethod(api)) {
                await api.shutdown();
            }
        }
        await this.models.shutdown();
        this.models.state.triggerEvent('shutdown');
    }

    /**
     * Get the models
     * Note: avoid using. Will be removed/reworked in the future.
     * @returns The models
     */
    public getModels(): Models {
        this.models.state.assertCurrentState('Initialised');
        return this.models;
    }

    /**
     * Get the Chat API
     */
    public chat(): ChatApi {
        this.models.state.assertCurrentState('Initialised');
        if (this.api.chatApi === undefined) {
            this.api.chatApi = new ChatApi(this, this.models);
        }
        return this.api.chatApi;
    }

    /**
     * Get the Leute API
     */
    public leute(): LeuteApi {
        this.models.state.assertCurrentState('Initialised');
        if (this.api.leuteApi === undefined) {
            this.api.leuteApi = new LeuteApi(this, this.models);
        }
        return this.api.leuteApi;
    }

    public data(): DataApi {
        this.models.state.assertCurrentState('Initialised');
        if (this.api.dataApi === undefined) {
            this.api.dataApi = new DataApi(this, this.models);
        }
        return this.api.dataApi;
    }

    public internetOfPeople(): InternetOfPeopleApi {
        this.models.state.assertCurrentState('Initialised');
        if (this.api.internetOfPeopleApi === undefined) {
            this.api.internetOfPeopleApi = new InternetOfPeopleApi(this, this.models);
        }
        return this.api.internetOfPeopleApi;
    }

    public internetOfMe(): InternetOfMeApi {
        this.models.state.assertCurrentState('Initialised');
        if (this.api.internetOfMeApi === undefined) {
            this.api.internetOfMeApi = new InternetOfMeApi(this, this.models);
        }
        return this.api.internetOfMeApi;
    }

    public trust(): TrustApi {
        this.models.state.assertCurrentState('Initialised');
        if (this.api.trustApi === undefined) {
            this.api.trustApi = new TrustApi(this, this.models);
        }
        return this.api.trustApi;
    }

    /**
     * Get the AI API for AI assistant functionality
     */
    public ai(): AIApi {
        this.models.state.assertCurrentState('Initialised');
        if (this.api.aiApi === undefined) {
            this.api.aiApi = new AIApi(this, this.models);
        }
        return this.api.aiApi;
    }
}

/**
 * Check if the object has a shutdown method
 * @param obj - The object to check
 * @returns True if the object has a shutdown method, false otherwise
 */
function hasShutdownMethod(obj: unknown): obj is {shutdown: () => Promise<void>} {
    return typeof obj === 'object' && obj !== null && 'shutdown' in obj;
}

/**
 * Check if the API has an init method
 * @param obj - The object to check
 * @returns True if the object has an init method, false otherwise
 */
function hasInitMethod(obj: unknown): obj is {init: (config: unknown) => Promise<void> | void} {
    return typeof obj === 'object' && obj !== null && 'init' in obj;
}
