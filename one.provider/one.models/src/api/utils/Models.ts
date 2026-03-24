import {StateMachine} from '../../misc/StateMachine.js';
import ChannelManager from '../../models/ChannelManager.js';
import TopicModel from '../../models/Chat/TopicModel.js';
import ConnectionsModel, {
    type ConnectionsModelConfiguration
} from '../../models/ConnectionsModel.js';
import DocumentModel from '../../models/DocumentModel.js';
import IoMManager from '../../models/IoM/IoMManager.js';
import LeuteModel from '../../models/Leute/LeuteModel.js';
import QuestionnaireModel from '../../models/QuestionnaireModel.js';
import type {ModelsHelperType, ModelsTypes, OneApiCreateConfig, OneApiInitConfig} from './types.js';

export default class Models implements ModelsHelperType {
    private models: {
        leuteModel?: LeuteModel;
        channelManager?: ChannelManager;
        questionnaireModel?: QuestionnaireModel;
        documentModel?: DocumentModel;
        iomManager?: IoMManager;
        topicModel?: TopicModel;
        connectionsModel?: ConnectionsModel;
    } = {};
    public state: StateMachine<'Uninitialised' | 'Initialised', 'shutdown' | 'init'>;

    constructor(
        commServerUrl: string,
        externalModels?: OneApiCreateConfig['externalModels'],
        connectionsModelConfig?: Partial<ConnectionsModelConfiguration>
    ) {
        this.state = new StateMachine<'Uninitialised' | 'Initialised', 'shutdown' | 'init'>();
        this.state.addState('Initialised');
        this.state.addState('Uninitialised');
        this.state.addEvent('init');
        this.state.addEvent('shutdown');
        this.state.addTransition('shutdown', 'Initialised', 'Uninitialised');
        this.state.addTransition('init', 'Uninitialised', 'Initialised');
        this.state.setInitialState('Uninitialised');
        this.models = {};

        if (externalModels !== undefined) {
            if (typeof externalModels === 'boolean' && externalModels === false) {
                this.models.leuteModel = new LeuteModel(commServerUrl);
                this.models.channelManager = new ChannelManager(this.models.leuteModel);
                this.models.questionnaireModel = new QuestionnaireModel(this.models.channelManager);
                this.models.documentModel = new DocumentModel(this.models.channelManager);
                this.models.iomManager = new IoMManager(this.models.leuteModel, commServerUrl);
                this.models.topicModel = new TopicModel(
                    this.models.channelManager,
                    this.models.leuteModel
                );
                return;
            } else if (typeof externalModels === 'object') {
                if (!externalModels.leuteModel) {
                    this.models.leuteModel = new LeuteModel(commServerUrl);
                }
                if (!externalModels.channelManager && this.models.leuteModel !== undefined) {
                    this.models.channelManager = new ChannelManager(this.models.leuteModel);
                }
                if (
                    !externalModels.questionnaireModel &&
                    this.models.channelManager !== undefined
                ) {
                    this.models.questionnaireModel = new QuestionnaireModel(
                        this.models.channelManager
                    );
                }
                if (!externalModels.documentModel && this.models.channelManager !== undefined) {
                    this.models.documentModel = new DocumentModel(this.models.channelManager);
                }
                if (!externalModels.iomManager && this.models.leuteModel !== undefined) {
                    this.models.iomManager = new IoMManager(this.models.leuteModel, commServerUrl);
                }
                if (
                    !externalModels.topicModel &&
                    this.models.channelManager !== undefined &&
                    this.models.leuteModel !== undefined
                ) {
                    this.models.topicModel = new TopicModel(
                        this.models.channelManager,
                        this.models.leuteModel
                    );
                }
                if (!externalModels.connectionsModel && this.models.leuteModel !== undefined) {
                    this.models.connectionsModel = new ConnectionsModel(
                        this.models.leuteModel,
                        connectionsModelConfig ?? {
                            commServerUrl,
                            acceptIncomingConnections: true,
                            acceptUnknownInstances: true,
                            acceptUnknownPersons: false,
                            allowPairing: true,
                            allowDebugRequests: true,
                            pairingTokenExpirationDuration: 60000 * 15, // qr-code (invitation) timeout
                            establishOutgoingConnections: true
                        }
                    );
                }
            }
        }
    }

    async init(config?: OneApiInitConfig) {
        if (config !== undefined && config.initedModels !== undefined) {
            let models: ModelsTypes;
            if (typeof config.initedModels === 'function') {
                models = await config.initedModels();
            } else {
                models = config.initedModels;
            }
            this.models.topicModel = models.topicModel;
            this.models.leuteModel = models.leuteModel;
            this.models.iomManager = models.iomManager;
            this.models.channelManager = models.channelManager;
            this.models.documentModel = models.documentModel;
            this.models.questionnaireModel = models.questionnaireModel;
            this.models.connectionsModel = models.connectionsModel;
        } else {
            for (const model of Object.values(this.models)) {
                await model.init();
            }
        }
        this.state.triggerEvent('init');
    }

    /**
     * Shutdown module
     */
    async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');
        for (const model of Object.values(this.models)) {
            await model.shutdown();
        }
        this.state.triggerEvent('shutdown');
    }

    getConnectionsModel(): ConnectionsModel {
        this.state.assertCurrentState('Initialised');
        if (this.models.connectionsModel === undefined) {
            throw new Error('ConnectionsModel not initialized');
        }
        return this.models.connectionsModel;
    }

    getLeuteModel(): LeuteModel {
        this.state.assertCurrentState('Initialised');
        if (this.models.leuteModel === undefined) {
            throw new Error('LeuteModel not initialized');
        }
        return this.models.leuteModel;
    }

    getChannelManager(): ChannelManager {
        this.state.assertCurrentState('Initialised');
        if (this.models.channelManager === undefined) {
            throw new Error('ChannelManager not initialized');
        }
        return this.models.channelManager;
    }

    getQuestionnaireModel(): QuestionnaireModel {
        this.state.assertCurrentState('Initialised');
        if (this.models.questionnaireModel === undefined) {
            throw new Error('QuestionnaireModel not initialized');
        }
        return this.models.questionnaireModel;
    }

    getDocumentModel(): DocumentModel {
        this.state.assertCurrentState('Initialised');
        if (this.models.documentModel === undefined) {
            throw new Error('DocumentModel not initialized');
        }
        return this.models.documentModel;
    }

    getIoMManager(): IoMManager {
        this.state.assertCurrentState('Initialised');
        if (this.models.iomManager === undefined) {
            throw new Error('IoMManager not initialized');
        }
        return this.models.iomManager;
    }

    getTopicModel(): TopicModel {
        this.state.assertCurrentState('Initialised');
        if (this.models.topicModel === undefined) {
            throw new Error('TopicModel not initialized');
        }
        return this.models.topicModel;
    }
}
