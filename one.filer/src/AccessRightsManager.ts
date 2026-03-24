import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object';
import type {LeuteModel} from '@refinio/one.models/lib/models';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks';
import type {Group, Instance, Person} from '@refinio/one.core/lib/recipes';
import {serializeWithType} from '@refinio/one.core/lib/util/promise';
import {isObject} from '@refinio/one.core/lib/util/type-checks-basic';
import type {ConnectionsModel} from '@refinio/one.models/lib/models';
import {getAllEntries} from '@refinio/one.core/lib/reverse-map-query';
import {sign} from '@refinio/one.models/lib/misc/Signature';
import type {VersionedObjectResult} from '@refinio/one.core/lib/storage-versioned-objects';
import {getObjectByIdHash, onVersionedObj} from '@refinio/one.core/lib/storage-versioned-objects';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common';
import {createAccess} from '@refinio/one.core/lib/access';

/**
 * This type defines how access rights for channels are specified
 */
interface ChannelAccessRights {
    owner: SHA256IdHash<Person>; // The owner of the channels
    persons: Array<SHA256IdHash<Person>>; // The persons who should gain access
    groups: Array<SHA256IdHash<Group>>; // The persons who should gain access
    channels: string[]; // The channels that should gain access
}

interface GroupConfig {
    iom?: SHA256IdHash<Group>;
    everyone?: SHA256IdHash<Group>;
}

/**
 * This class manages all access rights for the replicant.
 */
export default class AccessRightsManager {
    private readonly channelManager: ChannelManager;
    private readonly leuteModel: LeuteModel;
    private initialized: boolean = false;
    private groupConfig: GroupConfig = {};

    /**
     * Create a new instance.
     *
     * @param connectionsModel
     * @param channelManager
     * @param leuteModel
     */
    constructor(
        connectionsModel: ConnectionsModel,
        channelManager: ChannelManager,
        leuteModel: LeuteModel
    ) {
        this.channelManager = channelManager;
        this.leuteModel = leuteModel;

        // Register hook for new connections && contacts
        connectionsModel.pairing.onPairingSuccess(AccessRightsManager.trustPairingKeys.bind(this));
        onVersionedObj.addListener(this.shareProfileWithEverybody.bind(this));
    }

    /**
     * Set up the access rights handling for the application on the current instance.
     *
     * @returns {Promise<void>}
     */
    public async init(groups?: GroupConfig): Promise<void> {
        if (this.initialized) {
            throw new Error('The SmilerAccessRightsModel is already initialized');
        }

        if (groups) {
            this.groupConfig = groups;
        }

        await this.channelManager.createChannel('contacts');

        // const mainContactObjects = await this.leuteModel.getContactObjectHashes(this.mainId);
        // await this.channelManager.postToChannelIfNotExist(
        //     'contacts',
        //     await getObject(mainContactObjects[0])
        // );

        await this.giveAccessToChannels();

        this.initialized = true;
    }

    /**
     * Shuts everything down.
     *
     * @returns {Promise<void>}
     */
    public async shutdown(): Promise<void> {
        this.initialized = false;
    }

    /**
     * Handler for new versions or new profiles.
     * @param result
     */
    private async shareProfileWithEverybody(result: VersionedObjectResult): Promise<void> {
        try {
            if (result.obj.$type$ !== 'Profile' || !this.initialized) {
                return;
            }

            await serializeWithType('Share', async () => {
                const setAccessParam = {
                    id: result.idHash,
                    person: [],
                    group: this.groups('everyone'),
                    mode: SET_ACCESS_MODE.ADD
                };
                await createAccess([setAccessParam]);
            });
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * This function trusts the keys of the newly paired connection.
     *
     * Since keys are transported after the established connection via chum, we need to wait
     * for a while until keys are available. => 10 retries each seconds.
     *
     * @param _initiatedLocally
     * @param _localPersonId
     * @param _localInstanceId
     * @param remotePersonId
     * @param _remoteInstanceId
     * @param _token
     */
    private static async trustPairingKeys(
        _initiatedLocally: boolean,
        _localPersonId: SHA256IdHash<Person>,
        _localInstanceId: SHA256IdHash<Instance>,
        remotePersonId: SHA256IdHash<Person>,
        _remoteInstanceId: SHA256IdHash<Instance>,
        _token: string
    ): Promise<void> {
        try {
            const keys = await getAllEntries(remotePersonId, 'Keys');

            if (keys.length > 0) {
                console.log('Key signing succeeded', remotePersonId);
                await sign(keys[0]);
                return;
            }
        } catch (e) {
            console.error(e);
        }
    }

    private groups(...groupNames: Array<keyof GroupConfig>): Array<SHA256IdHash<Group>> {
        const groups: Array<SHA256IdHash<Group>> = [];

        for (const groupName of groupNames) {
            const groupConfigEntry = this.groupConfig[groupName];

            if (groupConfigEntry !== undefined) {
                groups.push(groupConfigEntry);
            }
        }

        return groups;
    }

    /**
     * Setup access rights for the patient app.
     *
     * Note that this function is just a hack until groups are functioning properly
     *
     * @returns {Promise<void>}
     */
    private async giveAccessToChannels(): Promise<void> {
        const mainId = await (await this.leuteModel.me()).mainIdentity();

        // Build list of access rights for our own channels
        const channelAccessRights = [
            {
                owner: mainId,
                persons: [],
                groups: this.groups('iom'),
                channels: [
                    'contacts',
                    'mainFileSystemChannelId',
                    'wbc',
                    'document',
                    'electrocardiogram',
                    'questionnaireResponse',
                    'consentFile',
                    'feedbackChannel',
                    'audioExercise'
                ]
            },
            {
                owner: mainId,
                persons: [],
                groups: this.groups('iom'),
                channels: [
                    'bodyTemperature',
                    'diary',
                    'newsChannel',
                    'incompleteQuestionnaireResponse'
                ]
            }
        ];

        await this.applyAccessRights(channelAccessRights);
    }

    /**
     * Apply the specified channel access rights by writing access objects.
     *
     * Note that the array should not have duplicate entries in regard to owner / channelname
     * combinations, otherwise only one of them will be applied. Which one is not deterministic.
     *
     * @param {ChannelAccessRights[]} channelAccessRights
     * @returns {Promise<void>}
     */
    private async applyAccessRights(channelAccessRights: ChannelAccessRights[]): Promise<void> {
        await serializeWithType('IdAccess', async () => {
            await Promise.all(
                channelAccessRights.map(async accessInfo => {
                    await Promise.all(
                        accessInfo.channels.map(async channelId => {
                            try {
                                const setAccessParam = {
                                    id: await calculateIdHashOfObj({
                                        $type$: 'ChannelInfo',
                                        id: channelId,
                                        owner: accessInfo.owner
                                    }),
                                    person: accessInfo.persons,
                                    group: accessInfo.groups,
                                    mode: SET_ACCESS_MODE.REPLACE
                                };
                                await getObjectByIdHash(setAccessParam.id); // To check whether a channel with this id exists
                                await createAccess([setAccessParam]);
                            } catch (error) {
                                // If the partner was not connected with this instance previously,
                                // then the calculateIdHashOfObj function will return a FileNotFoundError.
                                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                                if (isObject(error) && error.name !== 'FileNotFoundError') {
                                    console.error(error);
                                }
                            }
                        })
                    );
                })
            );
        });
    }
}
