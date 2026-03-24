import type {OneVersionedObjectInterfaces} from '@OneObjectInterfaces';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {getInstanceIdHash, getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {
    createCryptoApiFromDefaultKeys,
    getDefaultKeys
} from '@refinio/one.core/lib/keychain/keychain.js';
import type {
    Group,
    Instance,
    Keys,
    OneVersionedObjectTypeNames,
    Person
} from '@refinio/one.core/lib/recipes.js';
import {getOnlyLatestReferencingObjsHashAndId} from '@refinio/one.core/lib/reverse-map-query.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {VersionedObjectResult} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {
    getIdObject,
    getObjectByIdHash,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {createRandomString} from '@refinio/one.core/lib/system/crypto-helpers.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {LocalInstanceInfo} from '../../misc/ConnectionEstablishment/LeuteConnectionsModule.js';
import {
    createInstanceWithDefaultKeys,
    getInstancesOfPerson,
    getLocalInstanceOfPerson,
    hasPersonLocalInstance
} from '../../misc/instance.js';
import type {IdObjectResult} from '../../misc/ObjectEventDispatcher.js';
import {objectEvents} from '../../misc/ObjectEventDispatcher.js';
import {OEvent} from '../../misc/OEvent.js';
import {createPerson, createPersonWithDefaultKeys, isPersonComplete} from '../../misc/person.js';
import Watchdog from '../../misc/Watchdog.js';
import type {LinkedListEntry} from '../../recipes/ChannelRecipes.js';
import type {OneInstanceEndpoint} from '../../recipes/Leute/CommunicationEndpoints.js';
import type {Leute} from '../../recipes/Leute/Leute.js';
import type {PersonImage, PersonStatus} from '../../recipes/Leute/PersonDescriptions.js';
import type {Profile} from '../../recipes/Leute/Profile.js';
import type {Someone} from '../../recipes/Leute/Someone.js';
import IoMManager from '../IoM/IoMManager.js';
import TrustedKeysManager from './TrustedKeysManager.js';
import type {CreationTime} from '../../recipes/MetaRecipes.js';
import type {ObjectData, QueryOptions} from '../ChannelManager.js';
import {Model} from '../Model.js';
import GroupModel from './GroupModel.js';
import ProfileModel from './ProfileModel.js';
import SomeoneModel from './SomeoneModel.js';

const ZERO_HASH = '0'.repeat(64);

type PersonAndInstanceWithKeys = {
    personId: SHA256IdHash<Person>;
    personKeys: SHA256Hash<Keys>;
    instanceId: SHA256IdHash<Instance>;
    instanceKeys: SHA256Hash<Keys>;
};

/**
 * This class manages people - to be precise: their identities including your own.
 *
 * Identity is important for defining which data belongs to whom, with whom to share data ...
 * This class is one of the few central building blocks that makes the one ecosystem tick.
 *
 * It uses three concepts to manage identities:
 * - Person:  A person is the identity used throughout the application. Connections, messages
 *            access rights are all tied to a person. The SHA256Hash of the person object is
 *            what is usually used to refer to a person, so if we speak of person-id we usually mean
 *            the SHA256Hash<Person>. Another alias for a person / person-id is 'Identity'.
 * - Profile: A profile describes a person and ways how to contact that person.
 *            Multiple profiles for the same person are supported, because we think that you don't
 *            want to share the same profile about yourself with all persons you know. Perhaps you
 *            want to share a 'good boy' profile (nice profile image) with your family, but a
 *            bad-ass profile with your friends.
 * - Someone: A real life persons might want to create multiple identities. Use cases are:
 *            - Anonymous identities (throw away identities or for dating ...)
 *            - Work Identity / Private Identity to be able to separate work from private life
 *              better compared having one identity but a work and private profile.
 *            'Someone' is a collection of Identities that belongs to a single person. For other
 *            persons you usually only know a single identity, so the someone object of this person
 *            just refers to profiles of a single identity. But for your own you will have lots of
 *            Identities. Someone is only a local mechanism to group multiple identities of the
 *            same person. It has no meaning beyond the own ONE ecosystem.
 *
 * Q: How are Person / Profile and Someone related?
 * A: Someone refers to multiple profiles, a profile refers to an identity.
 *
 * Q: What are the responsibilities of this model?
 * A:
 * 1) Manage all those identities
 *    - Create new identities
 *    - Get a list of identities / own identities
 * 2) Manage the profiles describe those identities.
 *    - create / update / delete profiles
 *    - share profiles with others / get sharing state
 *    - obtain profiles
 *
 * Other important information:
 *    - Each profile has an owner. It is a namespacing mechanism. Only the owner should write
 *    the profile. This should be enforces in the future.
 *    - The 'default' profile where personId and owner are the same has a special meaning: It is
 *    the profile that is automatically updated with ne sign keys etc, and this is also the
 *    profile that is shared by default with other people.
 */
export default class LeuteModel extends Model {
    // #### Events ####

    public onProfileUpdate: OEvent<(profile: Profile, isMe: boolean) => void> = new OEvent();
    public onMeIdentitiesChange: OEvent<() => void> = new OEvent();

    // Emitted when a new instance endpoint was added to leute
    // Note: It might be emitted also for already known endpoints at the moment.
    public onNewOneInstanceEndpoint = new OEvent<
        (endpoint: OneInstanceEndpoint, isMe: boolean) => void
    >();

    public beforeMainIdSwitch: OEvent<
        (oldIdentity: SHA256IdHash<Person>, newIdentity: SHA256IdHash<Person>) => void
    > = new OEvent();

    public afterMainIdSwitch: OEvent<
        (oldIdentity: SHA256IdHash<Person>, newIdentity: SHA256IdHash<Person>) => void
    > = new OEvent();

    // #### Events - END ####

    public static readonly EVERYONE_GROUP_NAME = 'everyone';

    private readonly commserverUrl: string;

    private pLoadedVersion?: SHA256Hash<Leute>;
    private leute?: Leute;
    private readonly createEveryoneGroup: boolean;
    private shutdownInternal: () => Promise<void> = async () => {
        /*...*/
    };

    // Map that stores display names
    private personNameCache = new Map<SHA256IdHash<Person>, string>();
    private everyoneGroupNewPeopleCache: SHA256IdHash<Person>[] = [];
    private everyoneGroupWatchdog: Watchdog = new Watchdog(10000);

    private trustedKeysManager = new TrustedKeysManager(this);

    get trust(): TrustedKeysManager {
        return this.trustedKeysManager;
    }

    /**
     * Constructor
     *
     * @param commserverUrl - when creating the default oneInstanceEndpoint this url is used
     * @param createEveryoneGroup -  If true then init() should create an everyone group and add
     * listeners for new 'Person' objects and add them if they are not in the everyone group.
     * (default: false)
     */
    constructor(commserverUrl: string, createEveryoneGroup: boolean = false) {
        super();
        this.commserverUrl = commserverUrl;
        this.createEveryoneGroup = createEveryoneGroup;
    }

    /**
     * Init the module.
     *
     * This will initialize the data structures for 'me': someone, profile and a
     * OneInstanceEndpoint for the current instance.
     * As main identity the owner of the main one instance is used. This might change in the future!
     */
    public async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');

        // Reuse the instance and person from one.core
        const personId = getInstanceOwnerIdHash();
        if (personId === undefined) {
            throw new Error('The instance has no owner.');
        }

        try {
            await this.loadLatestVersion();
        } catch (e) {
            const instanceId = getInstanceIdHash();
            if (instanceId === undefined) {
                throw new Error('The instance is not initialized.');
            }

            const profile = await this.createInitialDefaultProfile({
                personId,
                personKeys: await getDefaultKeys(personId),
                instanceId,
                instanceKeys: await getDefaultKeys(instanceId)
            });

            const someone = await SomeoneModel.constructWithNewSomeone(this, 'me', profile);

            // Assign the leute object to the member for the saveAndLoad function
            // I know this member passing around isn't ideal. We should fix this later, to make it more
            // explicit what happens here.
            this.leute = {
                $type$: 'Leute',
                appId: 'one.leute',
                me: someone.idHash,
                other: [],
                group: []
            };

            await this.saveAndLoad();

            // Give the new main identity all rights, so that he can declare trust for other keys
            await this.givePersonAllRights(personId, personId);
        }

        const disconnectFns: Array<() => void> = [];
        disconnectFns.push(
            objectEvents.onNewVersion(
                async result => {
                    await this.addProfileFromResult(result);
                    await this.updatePersonNameCacheForPerson(result.obj.personId);
                },
                'LeuteModel: New profile version - Add profile and update person name cache',
                'Profile'
            ),
            objectEvents.onNewVersion(
                async result => {
                    for (const [id] of result.obj.identities.entries()) {
                        await this.updatePersonNameCacheForPerson(id).catch(console.error);
                    }
                },
                'LeuteModel: New someone version - Update person name cache for all identities',
                'Someone'
            ),
            this.everyoneGroupWatchdog.onTimeout(async () => {
                await this.syncEveryoneGroup();
            })
        );

        if (this.createEveryoneGroup) {
            const group = await this.createGroupInternal(LeuteModel.EVERYONE_GROUP_NAME);
            if (group.persons.find(person => person === personId) === undefined) {
                group.persons.push(personId);
                await group.saveAndLoad();
            }
            disconnectFns.push(
                objectEvents.onNewIdObject(
                    this.addPersonToEveryoneGroup.bind(this),
                    'LeuteModel: addPersonToEveryoneGroup',
                    'Person'
                )
            );
        }

        this.shutdownInternal = async () => {
            if (this.everyoneGroupWatchdog.enabled()) {
                this.everyoneGroupWatchdog.disable();
            }
            if (this.everyoneGroupNewPeopleCache.length > 0) {
                await this.syncEveryoneGroup();
            }
            await this.trust.shutdown();
            for (const disconnectFn of disconnectFns) {
                disconnectFn();
            }
            this.leute = undefined;
            this.pLoadedVersion = undefined;
            this.personNameCache.clear();
            this.shutdownInternal = async () => {
                /*...*/
            };
        };

        this.state.triggerEvent('init');

        await this.trust.init();
        await this.updatePersonNameCache();
    }

    /**
     * Shutdown the leute model
     */
    public async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');
        await this.shutdownInternal();
        this.state.triggerEvent('shutdown');
    }

    // ######## Me management ########

    /**
     * Get the someone that represents me.
     */
    public async me(): Promise<SomeoneModel> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }
        return SomeoneModel.constructFromLatestVersion(this.leute.me);
    }

    /**
     * Get the someone that represents me, but don't load the data, yet.
     *
     * In order to use the returned model you have to call one of its load functions first.
     */
    public meLazyLoad(): SomeoneModel {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }
        return new SomeoneModel(this.leute.me);
    }

    // ######## Other people management ########

    /**
     * Get all other persons you know.
     */
    public async others(): Promise<SomeoneModel[]> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }
        return Promise.all(this.leute.other.map(SomeoneModel.constructFromLatestVersion));
    }

    /**
     * Get all other persons you know, but don't grab the data, yet.
     *
     * In order to use the returned models you have to call one of its load functions first.
     */
    public othersLazyLoad(): SomeoneModel[] {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }
        return this.leute.other.map(idHash => new SomeoneModel(idHash));
    }

    /**
     * Add a new person
     *
     * @param other
     */
    public async addSomeoneElse(other: SHA256IdHash<Someone>): Promise<void> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }
        if (this.leute.me === other) {
            throw new Error('You cannot add yourself as other person');
        }

        const others = new Set(this.leute.other);
        others.add(other);
        this.leute.other = [...others];
        await this.saveAndLoad();
    }

    /**
     * Remove a person you know.
     *
     * @param other
     */
    public async removeSomeoneElse(other: SHA256IdHash<Someone>): Promise<void> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }

        this.leute.other = this.leute.other.filter(o => o !== other);
        await this.saveAndLoad();
    }

    // ######## Identity management ########

    /**
     * Create a new identity for myself with a complete set of keys and a 'default' profile.
     *
     * This will:
     * - Create a new person (random email or the specified one)
     * - Create complete keypairs for person
     * - Create a new instance owned by the new person (random instance name or the specified one)
     * - Create complete keypairs for instance
     * - Create a 'default' profile for the new identity owned by itself
     * - Certify profile with "TrustKeys" certificate issued by your main identity
     * - Certify profile with "AffirmationCertificate" certificate issued by the new identity
     */
    public async createCompleteIdentityForMyself(
        email?: string,
        instanceName?: string
    ): Promise<ProfileModel> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }

        const me = await this.me();

        // Create the new identity
        const idInfo = await LeuteModel.createIdentityWithInstanceAndKeys(email, instanceName);

        // Add identity first so that the profile creation event has it
        await me.addIdentity(idInfo.personId);
        const defaultProfile = await this.createInitialDefaultProfile(idInfo);

        // Add the profile, so that it is added before this function resolves. (The hook will do
        // the same, but we cannot await on the hook)
        await me.addProfile(defaultProfile.idHash);
        await this.shareVersionsWithEveryone(defaultProfile.idHash);

        // Create certificates and share it
        if (defaultProfile.loadedVersion !== undefined) {
            const trustKeysCert = await this.trust.certify('TrustKeysCertificate', {
                profile: defaultProfile.loadedVersion
            });
            const affirmationCert = await this.trust.affirm(
                defaultProfile.loadedVersion,
                idInfo.personId
            );

            // Share certificates
            await this.shareObjectWithIoM(trustKeysCert.signature.hash);
            await this.shareObjectWithEveryone(affirmationCert.hash);
        }

        return defaultProfile;
    }

    /**
     * Create a new identity for someone with a 'default' profile.
     *
     * This will:
     * - Create a new person (random email or the specified one)
     * - Create an empty 'default' profile for the new identity owned by your main identity
     */
    public async createShallowIdentityForSomeone(
        someoneId: SHA256IdHash<Someone>,
        email?: string
    ): Promise<ProfileModel> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }

        const someone = await SomeoneModel.constructFromLatestVersion(someoneId);

        const newPersonId = await createPerson(email);
        await someone.addIdentity(newPersonId);
        return someone.createProfile('default', newPersonId, await this.myMainIdentity());
    }

    /**
     * Create someone with a completely new identity.
     */
    public async createSomeoneWithShallowIdentity(email?: string): Promise<SHA256IdHash<Someone>> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }

        const newPersonId = await createPerson(email);
        const newProfile = await ProfileModel.constructWithNewProfile(
            newPersonId,
            await this.myMainIdentity(),
            'default'
        );
        // Call the hook (even if it already runs) - this ensures, that the profile was added to
        // a someone object
        await this.addProfile(newProfile.idHash);

        const someone = await this.getSomeone(newPersonId);
        if (someone === undefined) {
            throw new Error('Impossible error: Someone does not exist even though the hook ran');
        }

        return someone.idHash;
    }

    /**
     * Create a new profile for someone.
     *
     * @param personId - The Person for which to create the personId
     * @param profileId - The profile id. Defaults to a random string.
     * @param ensureSomeoneId - if specified, ensure that this someone object is the found object.
     */
    public async createProfileForPerson(
        personId: SHA256IdHash<Person>,
        profileId?: string,
        ensureSomeoneId?: SHA256IdHash<Someone>
    ): Promise<ProfileModel> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }

        const someone = await this.getSomeone(personId);

        if (someone === undefined) {
            throw new Error('Failed to create profile, because no someone object could be found.');
        }

        return someone.createProfile(
            profileId === undefined ? await createRandomString(32) : profileId,
            personId,
            await this.myMainIdentity()
        );
    }

    // ######## Group management ########

    /**
     * Create a new group.
     *
     * If it already exist this will return the existing group instead.
     *
     * @param name - If specified use this name, otherwise create a group with a random id.
     * @returns the created group or the existing one if it already existed.
     */
    public async createGroup(name?: string): Promise<GroupModel> {
        this.state.assertCurrentState('Initialised');
        return this.createGroupInternal(name);
    }

    /**
     * Get a list of groups.
     */
    public async groups(): Promise<GroupModel[]> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }

        return Promise.all(this.leute.group.map(GroupModel.constructFromLatestProfileVersion));
    }

    public static async everyoneGroup(): Promise<GroupModel> {
        try {
            return await GroupModel.constructFromLatestProfileVersionByGroupName(
                LeuteModel.EVERYONE_GROUP_NAME
            );
        } catch (e) {
            throw new Error(`Everyone group does not exist: ${e.message}`);
        }
    }

    // ######## Misc stuff ########

    /**
     * Return the SomeoneModel identified by the person Id or undefined otherwise.
     * @param personId
     */
    public async getSomeone(personId: SHA256IdHash<Person>): Promise<SomeoneModel | undefined> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            console.error(
                'getSomeone: Leute model does not seem to be initialized (this.leute is null)'
            );
            return;
        }

        try {
            const entries = await getOnlyLatestReferencingObjsHashAndId(personId, 'Someone');

            // Find the entry that is present in the leute list
            const leute = this.leute;
            const entry = entries.find(
                e => leute.me === e.idHash || leute.other.includes(e.idHash)
            );

            if (entry === undefined) {
                return undefined;
            }

            return SomeoneModel.constructFromVersion(entry.hash);
        } catch (e) {
            if (e.name === 'FileNotFoundError') {
                return;
            }

            throw e;
        }
    }

    async hasProfile(profileId: SHA256IdHash<Profile>): Promise<boolean> {
        this.state.assertCurrentState('Initialised');

        if (this.leute === undefined) {
            console.error(
                'hasProfile: Leute model does not seem to be initialized (this.leute is null)'
            );
            return false;
        }

        const someones = await getOnlyLatestReferencingObjsHashAndId(profileId, 'Someone');

        for (const someone of someones) {
            if (this.leute.other.includes(someone.idHash)) {
                return true;
            }
            if (this.leute.me === someone.idHash) {
                return true;
            }
        }

        return false;
    }

    /**
     * Return the main ProfileModel of the SomeoneModel identified by the personId.
     * @param personId
     */
    public async getMainProfile(personId: SHA256IdHash<Person>): Promise<ProfileModel> {
        this.state.assertCurrentState('Initialised');

        const someone = await this.getSomeone(personId);

        if (someone === undefined) {
            throw new Error(`No someone found for the given personId: ${personId}`);
        }

        return someone.mainProfile();
    }

    /**
     * Sets a new profile for myself.
     *
     * If the profile has a different identity, than the old one the main identity will change!
     *
     * @param profileHash
     */
    public async setMyMainProfile(profileHash: SHA256IdHash<Profile>) {
        const profile = await getIdObject(profileHash);
        const mySomeone = await this.me();
        const oldIdentity = await mySomeone.mainIdentity();
        const newIdentity = profile.personId;

        if (oldIdentity === newIdentity) {
            await mySomeone.setMainProfile(profileHash);
        } else {
            if (!(await isPersonComplete(newIdentity))) {
                throw new Error('Person is not complete!');
            }
            this.beforeMainIdSwitch.emit(oldIdentity, newIdentity);
            await this.givePersonAllRights(newIdentity, newIdentity);
            await mySomeone.setMainProfile(profileHash);
            this.afterMainIdSwitch.emit(oldIdentity, newIdentity);
        }
    }

    /**
     * Get my own main profile.
     */
    public async getMyMainProfile(): Promise<ProfileModel> {
        const mySomeone = await this.me();
        return await mySomeone.mainProfile();
    }

    /**
     * Change the main identity by setting a new mainProfile.
     *
     * @param newIdentity
     */
    public async changeMyMainIdentity(newIdentity: SHA256IdHash<Person>) {
        const mySomeone = await this.me();
        const oldIdentity = await mySomeone.mainIdentity();
        if (!(await isPersonComplete(newIdentity))) {
            throw new Error('Person is not complete!');
        }
        this.beforeMainIdSwitch.emit(oldIdentity, newIdentity);
        await this.givePersonAllRights(newIdentity, newIdentity);
        await mySomeone.setMainIdentity(newIdentity);
        this.afterMainIdSwitch.emit(oldIdentity, newIdentity);
    }

    /**
     * Get my own main identity (at the moment from the main profile).
     */
    public async myMainIdentity(): Promise<SHA256IdHash<Person>> {
        const mySomeone = await this.me();
        return mySomeone.mainIdentity();
    }

    /**
     * Add a profile to a someone object already managing this persons identity.
     *
     * If no such someone object exists a new one is created.
     */
    public async addProfile(profile: SHA256IdHash<Profile>): Promise<void> {
        this.state.assertCurrentState('Initialised');
        await this.addProfileFromResult(await getObjectByIdHash(profile));
    }

    /**
     * Get my own instance endpoints.
     *
     * @param mainOnly - If true, then only get endpoints for your main identity.
     */
    public async findAllOneInstanceEndpointsForMe(mainOnly = true): Promise<OneInstanceEndpoint[]> {
        this.state.assertCurrentState('Initialised');

        const me = await this.me();
        return me.collectAllEndpointsOfType(
            'OneInstanceEndpoint',
            mainOnly ? await me.mainIdentity() : undefined
        );
    }

    /**
     * Get all instance endpoints for person.
     *
     * @param personId
     */
    public async findAllOneInstanceEndpointsForPerson(
        personId: SHA256IdHash<Person>
    ): Promise<OneInstanceEndpoint[]> {
        this.state.assertCurrentState('Initialised');

        const someone = await this.getSomeone(personId);
        if (someone === undefined) {
            return [];
        }

        return someone.collectAllEndpointsOfType('OneInstanceEndpoint', personId);
    }

    /**
     * Get instance endpoints from all contacts.
     */
    public async findAllOneInstanceEndpointsForOthers(): Promise<OneInstanceEndpoint[]> {
        this.state.assertCurrentState('Initialised');

        const others = await this.others();
        const endpoints = await Promise.all(
            others.map(someone => someone.collectAllEndpointsOfType('OneInstanceEndpoint'))
        );
        return endpoints.reduce((acc, curr) => acc.concat(curr), []);
    }

    /**
     * Collect all remote instances of my other devices.
     */
    public async getMyLocalEndpoints(
        personId?: SHA256IdHash<Person>
    ): Promise<OneInstanceEndpoint[]> {
        const oneInstanceEndpoints: OneInstanceEndpoint[] = [];

        const me = await this.me();

        for (const identity of personId === undefined ? me.identities() : [personId]) {
            const instances = await getInstancesOfPerson(identity);
            const instancesMap = new Map(
                instances.map(instance => [instance.instanceId, instance.local])
            );

            const endpoints = await me.collectAllEndpointsOfType('OneInstanceEndpoint', identity);

            // Only keep the endpoints for which we do not have a complete keypair => remote
            oneInstanceEndpoints.push(
                ...endpoints.filter(endpoint => {
                    const isLocal = instancesMap.get(endpoint.instanceId);

                    if (isLocal === undefined) {
                        console.error(
                            `Internal error: We do not have an instance object for the OneInstanceEndpoint, instanceId: ${endpoint.instanceId}`
                        );
                        return false;
                    }

                    return isLocal;
                })
            );
        }

        return oneInstanceEndpoints;
    }

    /**
     * Collect all remote instances of my other devices.
     */
    public async getInternetOfMeEndpoints(): Promise<OneInstanceEndpoint[]> {
        const oneInstanceEndpoints: OneInstanceEndpoint[] = [];

        const me = await this.me();

        for (const identity of me.identities()) {
            const instances = await getInstancesOfPerson(identity);
            const instancesMap = new Map(
                instances.map(instance => [instance.instanceId, instance.local])
            );

            const endpoints = await me.collectAllEndpointsOfType('OneInstanceEndpoint', identity);

            // Only keep the endpoints for which we do not have a complete keypair => remote
            oneInstanceEndpoints.push(
                ...endpoints.filter(endpoint => {
                    const isLocal = instancesMap.get(endpoint.instanceId);

                    if (isLocal === undefined) {
                        console.error(
                            `Internal error: We do not have an instance object for the OneInstanceEndpoint, instanceId: ${endpoint.instanceId}`
                        );
                        return false;
                    }

                    return !isLocal;
                })
            );
        }

        return oneInstanceEndpoints;
    }

    /**
     * Collect all remote instances of everyone else.
     */
    public async getInternetOfPeopleEndpoints(): Promise<OneInstanceEndpoint[]> {
        return this.findAllOneInstanceEndpointsForOthers();
    }

    /**
     * Collect all IoM and IoP endpoints.
     */
    public async getAllRemoteEndpoints(): Promise<
        {
            endpoint: OneInstanceEndpoint;
            isIoM: boolean;
        }[]
    > {
        const iomEndpoints = await this.getInternetOfMeEndpoints();
        const iopEndpoints = await this.getInternetOfPeopleEndpoints();

        return [
            ...iomEndpoints.map(endpoint => ({
                endpoint,
                isIoM: true
            })),
            ...iopEndpoints.map(endpoint => ({
                endpoint,
                isIoM: false
            }))
        ];
    }

    /**
     *  Collect all local instances that represent this device.
     *
     *  Note: LeuteModel is probably not the correct place for this ... but instances.ts neither
     */
    public async getMyLocalInstances(): Promise<LocalInstanceInfo[]> {
        const me = await this.me();

        const localInstances: LocalInstanceInfo[] = [];
        for (const identity of me.identities()) {
            if (!(await hasPersonLocalInstance(identity))) {
                continue;
            }

            const instanceId = await getLocalInstanceOfPerson(identity);

            localInstances.push({
                instanceId,
                instanceCryptoApi: await createCryptoApiFromDefaultKeys(instanceId),
                personId: identity
            });
        }

        return localInstances;
    }

    /**
     *  Collect all local instances that represent this device.
     *
     *  Note: LeuteModel is probably not the correct place for this ... but instances.ts neither
     */
    public async getMyMainInstance(): Promise<LocalInstanceInfo> {
        const me = await this.me();

        const identity = await me.mainIdentity();
        const instanceId = await getLocalInstanceOfPerson(identity);

        return {
            instanceId,
            instanceCryptoApi: await createCryptoApiFromDefaultKeys(instanceId),
            personId: identity
        };
    }

    /**
     * Get the profile name from the main profile.
     *
     * @param personId
     */
    public async getMainProfileDisplayName(personId: SHA256IdHash<Person>): Promise<string> {
        this.state.assertCurrentState('Initialised');

        const someone = await this.getSomeone(personId);

        if (someone === undefined) {
            return 'undefined';
        }

        return someone.getMainProfileDisplayName();
    }

    /**
     * Get the profile name from one of the default profiles.
     *
     * It will first try to find the profile that we edited (I am owner).
     * Then it will try to find the profile that the person itself edited (He is owner)
     * Then it will look for a default profile from any owner.
     *
     * @param personId
     */
    public async getDefaultProfileDisplayName(personId: SHA256IdHash<Person>): Promise<string> {
        this.state.assertCurrentState('Initialised');

        const someone = await this.getSomeone(personId);

        if (someone === undefined) {
            return 'undefined';
        }

        return someone.getDefaultProfileDisplayName(personId, await this.myMainIdentity());
    }

    /**
     * Returns items for pictures that were updated.
     *
     * @param _queryOptions
     */
    public async *retrievePersonImagesForJournal(
        _queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<PersonImage>> {
        this.state.assertCurrentState('Initialised');

        const allProfiles = await this.getAllProfiles();

        const imagesWithPersonId: {personId: SHA256IdHash<Person>; image: PersonImage}[] = [];

        allProfiles.forEach((profile: ProfileModel) => {
            profile.descriptionsOfType('PersonImage').forEach(pi => {
                imagesWithPersonId.push({personId: profile.personId, image: pi});
            });
        });

        imagesWithPersonId.sort((imageWithPersonId1, imageWIthPersonId2) => {
            return imageWithPersonId1.image.timestamp < imageWIthPersonId2.image.timestamp
                ? 1
                : imageWithPersonId1.image.timestamp > imageWIthPersonId2.image.timestamp
                  ? -1
                  : 0;
        });

        const objectDatas = imagesWithPersonId.map(imageWithPersonId => {
            return {
                channelId: '',
                channelOwner: ZERO_HASH as SHA256IdHash<Person>,
                channelEntryHash: ZERO_HASH as SHA256Hash<LinkedListEntry>,
                id: '',
                creationTime: new Date(imageWithPersonId.image.timestamp),
                creationTimeHash: ZERO_HASH as SHA256Hash<CreationTime>,
                author: imageWithPersonId.personId,
                sharedWith: [],
                data: imageWithPersonId.image,
                dataHash: ZERO_HASH as SHA256Hash<PersonImage>
            };
        });

        yield* objectDatas;
    }

    /**
     * Returns items for statuses that were updated.
     *
     * @param _queryOptions
     */
    public async *retrieveStatusesForJournal(
        _queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<PersonStatus>> {
        this.state.assertCurrentState('Initialised');

        const allProfiles = await this.getAllProfiles();

        const statusesWithPersonId: {
            personId: SHA256IdHash<Person>;
            status: PersonStatus;
        }[] = [];

        allProfiles.forEach((profile: ProfileModel) => {
            profile.descriptionsOfType('PersonStatus').forEach(ps => {
                statusesWithPersonId.push({personId: profile.personId, status: ps});
            });
        });

        statusesWithPersonId.sort((status1, status2) => {
            return status1.status.timestamp < status2.status.timestamp
                ? 1
                : status1.status.timestamp > status2.status.timestamp
                  ? -1
                  : 0;
        });

        const objectDatas = statusesWithPersonId.map(statusWithPersonId => {
            return {
                channelId: '',
                channelOwner: ZERO_HASH as SHA256IdHash<Person>,
                channelEntryHash: ZERO_HASH as SHA256Hash<LinkedListEntry>,
                id: '',
                creationTime: new Date(statusWithPersonId.status.timestamp),
                creationTimeHash: ZERO_HASH as SHA256Hash<CreationTime>,
                author: statusWithPersonId.personId,
                sharedWith: [],
                data: statusWithPersonId.status,
                dataHash: ZERO_HASH as SHA256Hash<PersonStatus>
            };
        });

        yield* objectDatas;
    }

    public async shareObjectWithEveryone(object: SHA256Hash): Promise<void> {
        await this.shareObjectWithGroup(
            object,
            await calculateIdHashOfObj({
                $type$: 'Group',
                name: LeuteModel.EVERYONE_GROUP_NAME
            })
        );
    }

    public async shareVersionsWithEveryone(id: SHA256IdHash): Promise<void> {
        await this.shareVersionsWithGroup(
            id,
            await calculateIdHashOfObj({
                $type$: 'Group',
                name: LeuteModel.EVERYONE_GROUP_NAME
            })
        );
    }

    public async shareObjectWithIoM(object: SHA256Hash): Promise<void> {
        await this.shareObjectWithGroup(
            object,
            await calculateIdHashOfObj({
                $type$: 'Group',
                name: IoMManager.IoMGroupName
            })
        );
    }

    public async shareVersionsWithIoM(id: SHA256IdHash): Promise<void> {
        await this.shareVersionsWithGroup(
            id,
            await calculateIdHashOfObj({
                $type$: 'Group',
                name: IoMManager.IoMGroupName
            })
        );
    }

    public async shareObjectWithGroup(
        object: SHA256Hash,
        group: SHA256IdHash<Group>
    ): Promise<void> {
        await createAccess([
            {
                object,
                person: [],
                group: [group],
                mode: SET_ACCESS_MODE.ADD
            }
        ]);
    }

    public async shareVersionsWithGroup(
        id: SHA256IdHash,
        group: SHA256IdHash<Group>
    ): Promise<void> {
        await createAccess([
            {
                id,
                person: [],
                group: [group],
                mode: SET_ACCESS_MODE.ADD
            }
        ]);
    }

    // ######## Private stuff ########

    /**
     * Create a new group.
     *
     * If it already exist this will return the existing group instead.
     *
     * @param name - If specified use this name, otherwise create a group with a random id.
     * @returns the created group or the existing one if it already existed.
     */
    private async createGroupInternal(name?: string): Promise<GroupModel> {
        if (this.leute === undefined) {
            throw new Error('Leute model is not initialized');
        }

        const group = await GroupModel.constructWithNewGroup(name);
        if (!this.leute.group.includes(group.groupIdHash)) {
            this.leute.group.push(group.groupIdHash);
            await this.saveAndLoad();
        }
        return group;
    }

    /**
     * Create an identity and an instance and corresponding keys
     */
    private static async createIdentityWithInstanceAndKeys(
        email?: string,
        instanceName?: string
    ): Promise<PersonAndInstanceWithKeys> {
        // Just a note:
        // It is okay to not check if person / instance exists beforehand for strong exception
        // guarantee, because if the person does not exist it is guaranteed, that the instance
        // does not exist (instance depends on the person through owner).
        const personResult = await createPersonWithDefaultKeys(email);
        const instanceResult = await createInstanceWithDefaultKeys(
            personResult.personId,
            instanceName
        );
        return {...personResult, ...instanceResult};
    }

    /**
     * This gives a person all local rights - at the moment do declare trusted keys.
     *
     * @param beneficiary - The person that gets the rights
     * @param issuer - The person that gives the rights
     * @private
     */
    private async givePersonAllRights(
        beneficiary: SHA256IdHash<Person>,
        issuer?: SHA256IdHash<Person>
    ): Promise<void> {
        await this.trust.certify(
            'RightToDeclareTrustedKeysForEverybodyCertificate',
            {beneficiary},
            issuer
        );
        await this.trust.certify(
            'RightToDeclareTrustedKeysForSelfCertificate',
            {beneficiary},
            issuer
        );
    }

    // ######## Hooks for one.core ########

    /**
     * Add a profile to the respective someone object.
     *
     * This call is registered at one.core for listening for new profiles.
     *
     * @param result
     * @private
     */
    private async addProfileFromResult(result: VersionedObjectResult<Profile>): Promise<void> {
        await serializeWithType('addProfile', async () => {
            if (this.leute === undefined) {
                console.error(
                    'addProfileFromResult: Leute model does not seem to be initialized' +
                        ' (this.leute is null)'
                );
                return;
            }

            const entries = await getOnlyLatestReferencingObjsHashAndId(
                result.obj.personId,
                'Someone'
            );

            // Find the entry that is present in the leute list
            const leute = this.leute;
            const entry = entries.find(
                e => leute.me === e.idHash || leute.other.includes(e.idHash)
            );

            const isMe = entry !== undefined && entry.idHash === this.leute.me;

            // If no someone was found, create a new one.
            // Attention: We do currently not check if another someone removed from leute exists for
            // this profile. So if a someone object is removed from the contacts of leute and a new
            // profile is received, the contact will reappear with a new someone.
            if (entry === undefined) {
                const profileModel = await ProfileModel.constructFromResult(result);
                const someoneNew = await SomeoneModel.constructWithNewSomeone(
                    this,
                    await createRandomString(32),
                    profileModel
                );
                await this.addSomeoneElse(someoneNew.idHash);
            } else {
                const someone = await SomeoneModel.constructFromVersion(entry.hash);

                // on sync it could happen that the first profile
                // is not the default one, so when the default
                // profile is synced, we should correct it.
                if (!isMe && result.obj.profileId === 'default') {
                    await someone.setMainProfileIfNotDefault(result.idHash);
                }

                await someone.addProfile(result.idHash);
            }

            this.onProfileUpdate.emit(result.obj, isMe);

            const profileModel = await ProfileModel.constructFromResult(result);
            const endpoints = profileModel.endpointsOfType('OneInstanceEndpoint');

            // Emit new instance endpoint event (emits it also when it is not new ...)
            for (const endpoint of endpoints) {
                this.onNewOneInstanceEndpoint.emit(endpoint, isMe);
            }

            this.onUpdated.emit();
        });
    }

    /**
     * Add a person to the respective {@link LeuteModel.EVERYONE_GROUP_NAME} group.
     *
     * This call is registered at one.core for listening for new persons.
     *
     * @param result
     * @private
     */
    private async addPersonToEveryoneGroup(result: IdObjectResult<Person>): Promise<void> {
        this.everyoneGroupNewPeopleCache.push(result.idHash);

        if (this.everyoneGroupWatchdog.enabled()) {
            this.everyoneGroupWatchdog.restart();
        } else {
            this.everyoneGroupWatchdog.enable();
        }
    }

    /**
     * Write the accumulated persons to the everyone group.
     */
    private async syncEveryoneGroup(): Promise<void> {
        const group = await LeuteModel.everyoneGroup();

        for (const person of this.everyoneGroupNewPeopleCache) {
            if (!group.persons.includes(person)) {
                group.persons.push(person);
            }
        }

        this.everyoneGroupNewPeopleCache = [];
        if (this.everyoneGroupWatchdog.enabled()) {
            this.everyoneGroupWatchdog.disable();
        }

        await group.saveAndLoad();
    }

    /**
     * Updates the this.leute member on a new version.
     *
     * This call is registered at one.core for listening for new leute object versions.
     *
     * @param result
     * @private
     */
    private async updateLeuteMember(result: VersionedObjectResult) {
        if (isVersionedResultOfType(result, 'Leute')) {
            this.leute = result.obj;
            this.pLoadedVersion = result.hash;
            this.onUpdated.emit();
        }
    }

    // ######## Person name cache ########

    getPersonName(personId: SHA256IdHash<Person>): string {
        return this.personNameCache.get(personId) || 'N/A';
    }

    private async updatePersonNameCache(): Promise<void> {
        const me = await this.me();
        const others = await this.others();
        const myMainId = await me.mainIdentity();

        for (const someone of [me, ...others]) {
            const names = await someone.getDefaultProfileDisplayNames(myMainId);
            for (const [personId, name] of names) {
                this.personNameCache.set(personId, name);
            }
        }
    }

    private async updatePersonNameCacheForPerson(personId: SHA256IdHash<Person>): Promise<void> {
        const someone = await this.getSomeone(personId);
        if (someone === undefined) {
            return;
        }

        const name = await someone.getDefaultProfileDisplayName(
            personId,
            await this.myMainIdentity()
        );
        this.personNameCache.set(personId, name);
    }

    /**
     * Creates a 'default' profile for the specified person.
     *
     * It will be owned by the same person.
     *
     * @param idInfo
     * @private
     */
    private async createInitialDefaultProfile(
        idInfo: PersonAndInstanceWithKeys
    ): Promise<ProfileModel> {
        const personKeys = await getObject(idInfo.personKeys);

        // Note, that the returned profile model is the latest version after the merge, not the
        // exact version that you just wrote. The Problem are CRDTs - unmerged versions are not in
        // the version map, so they are not visible to the app and are not transmitted to other
        // instance.
        // The assumption ist, that no unauthorized person can change this crdt type, because
        // input filtering will prevent that (which does not exist, yet!)
        // Another solution would be to have a separate mechanism (besides version maps) that
        // manages intermediary versions (e.g. explicit tags).
        // Everything depends on how you view versions ... what is a version - what is a
        // document - can you have diverging paths in the same document ... etc.
        return await ProfileModel.constructWithNewProfile(
            idInfo.personId,
            idInfo.personId,
            'default',
            [
                {
                    $type$: 'OneInstanceEndpoint',
                    personId: idInfo.personId,
                    url: this.commserverUrl,
                    instanceId: idInfo.instanceId,
                    instanceKeys: idInfo.instanceKeys,
                    personKeys: idInfo.personKeys
                }
            ],
            [
                {
                    $type$: 'SignKey',
                    key: personKeys.publicSignKey
                }
            ]
        );
    }

    // ######## private stuff - Load & Save ########

    /**
     * Return all the profiles of all the someones, including my own profiles.
     */
    private async getAllProfiles(): Promise<ProfileModel[]> {
        const someoneModels = [await this.me(), ...(await this.others())];

        const profileModels2d = await Promise.all(
            someoneModels.map((other: SomeoneModel) => {
                return other.profiles();
            })
        );

        return profileModels2d.reduce((prev, next) => {
            return prev.concat(next);
        });
    }

    /**
     * Load the latest someone version.
     */
    private async loadLatestVersion(): Promise<void> {
        const idHash = await calculateIdHashOfObj({
            $type$: 'Leute',
            appId: 'one.leute'
        });
        const result = await getObjectByIdHash(idHash);

        await this.updateModelDataFromLeute(result.obj, result.hash);
    }

    /**
     * Save the leute to disk and load the latest version.
     *
     * Why is there no pure save() function? The cause are crdts. The object that is eventually
     * written to disk might differ from the current state of this instance. This happens when new
     * data was received via chum since the last load. This means that we don't have a hash
     * representing the current state.
     *
     * TODO: It is possible to write the intermediary state and obtain a hash. So we can implement a
     *       pure save() function. But this requires the lower levels to write the top level object
     *       of the tree and return the corresponding hash to the caller. The
     *       storeVersionedObjectCRDT and the plan interfaces don't support that right now in a easy
     *       to grasp way.
     */
    private async saveAndLoad(): Promise<void> {
        if (this.leute === undefined) {
            throw new Error('No leute data that could be saved');
        }

        const result = await storeVersionedObject(this.leute);

        await this.updateModelDataFromLeute(result.obj, result.hash);

        this.onUpdated.emit();
    }

    /**
     * Updates the members of the model based on a loaded profile and the version hash.
     *
     * @param leute
     * @param version
     * @private
     */
    private async updateModelDataFromLeute(
        leute: Leute,
        version: SHA256Hash<Leute>
    ): Promise<void> {
        this.pLoadedVersion = version;
        this.leute = leute;
    }
}

// ######## private functions ########

function isVersionedResultOfType<T extends OneVersionedObjectTypeNames>(
    versionedObjectResult: VersionedObjectResult,
    type: T
): versionedObjectResult is VersionedObjectResult<OneVersionedObjectInterfaces[T]> {
    return versionedObjectResult.obj.$type$ === type;
}

// function isUnversionedResultOfType<T extends OneUnversionedObjectTypeNames>(
//     unversionedObjectResult: UnversionedObjectResult,
//     type: T
// ): unversionedObjectResult is UnversionedObjectResult<OneUnversionedObjectInterfaces[T]> {
//     return unversionedObjectResult.obj.$type$ === type;
// }
