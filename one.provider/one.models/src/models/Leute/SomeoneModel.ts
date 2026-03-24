import type {Person} from '@refinio/one.core/lib/recipes.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {
    getIdObject,
    getObjectByIdHash,
    storeVersionedObject,
    type VersionedObjectResult
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

import {objectEvents} from '../../misc/ObjectEventDispatcher.js';
import {OEvent} from '../../misc/OEvent.js';
import type {
    CommunicationEndpointInterfaces,
    CommunicationEndpointTypeNames,
    CommunicationEndpointTypes
} from '../../recipes/Leute/CommunicationEndpoints.js';
import type {
    PersonDescriptionInterfaces,
    PersonDescriptionTypeNames,
    PersonDescriptionTypes
} from '../../recipes/Leute/PersonDescriptions.js';
import type {Profile} from '../../recipes/Leute/Profile.js';
import type {Someone} from '../../recipes/Leute/Someone.js';
import ProfileModel from './ProfileModel.js';

/**
 * This class is a nicer frontend for the Someone recipe.
 *
 * 'Someone' is a collection of several person identities that belong the the same real person.
 * Someone also collects all the profiles of those identities.
 *
 * Reasons for not using the Someone recipe directly:
 * - Because the whole identity management on the lower levels is pretty complicated. So it is much
 *   nicer for the users to have a nicer interface.
 */
export default class SomeoneModel {
    public onUpdate: OEvent<() => void> = new OEvent();

    public readonly idHash: SHA256IdHash<Someone>;
    private pSomeone?: Someone;

    private get someone(): Someone {
        if (this.pSomeone === undefined) {
            throw new Error('This someone model does not manage a somone object');
        }

        return this.pSomeone;
    }

    constructor(idHash: SHA256IdHash<Someone>) {
        this.idHash = idHash;

        // Setup the onUpdate event
        let disconnect: (() => void) | undefined;
        this.onUpdate.onListen(() => {
            if (!disconnect) {
                disconnect = objectEvents.onNewVersion(
                    async (result: VersionedObjectResult<Someone>) => {
                        await this.onUpdate.emitAll();
                    },
                    `SomeoneModel: onUpdate ${this.idHash}`,
                    'Someone',
                    this.idHash
                );
            }
        });
        this.onUpdate.onStopListen(() => {
            if (this.onUpdate.listenerCount() === 0) {
                if (disconnect !== undefined) {
                    disconnect();
                    disconnect = undefined;
                }
            }
        });
    }

    // ######## asynchronous constructors ########

    /**
     * Construct a new SomeoneModel with a specific version loaded.
     */
    public static async constructFromVersion(version: SHA256Hash<Someone>): Promise<SomeoneModel> {
        const someone = await getObject(version);
        const idHash = await calculateIdHashOfObj(someone);
        const newModel = new SomeoneModel(idHash);
        newModel.pSomeone = someone;
        return newModel;
    }

    /**
     * Construct a new SomeoneModel with the latest version loaded.
     */
    public static async constructFromLatestVersion(
        idHash: SHA256IdHash<Someone>
    ): Promise<SomeoneModel> {
        const newModel = new SomeoneModel(idHash);
        await newModel.loadLatestVersion();
        return newModel;
    }

    /**
     * Create a someone if it does not exist.
     *
     * If you specify descriptions and / or endpoints here and a someone version already exists
     * without those endpoints and / or descriptions it will add them again.
     *
     * @param leuteModel
     * @param someoneId
     * @param mainProfileModel
     * @returns The latest version of the someone or an empty someone.
     */
    public static async constructWithNewSomeone(
        leuteModel: any,
        someoneId: string,
        mainProfileModel: ProfileModel
    ): Promise<SomeoneModel> {
        // Create new someone object and calculate id hash
        const newSomeone: Someone = {
            $type$: 'Someone',
            someoneId,
            mainProfile: mainProfileModel.idHash,
            identities: new Map([])
        };

        const idHash = await calculateIdHashOfObj(newSomeone);

        // Add main profile to identity map using the in-memory model, avoiding a DB read
        newSomeone.identities.set(mainProfileModel.personId, new Set([mainProfileModel.idHash]));

        // Store new someone object
        const result = await storeVersionedObject(newSomeone);

        // COnstruct model
        const model = new SomeoneModel(idHash);
        model.pSomeone = result.obj;
        return model;
    }

    // ######## Identity management ########

    /**
     * Add an identity to the someone object and save it.
     *
     * @param identity
     */
    public async addIdentity(identity: SHA256IdHash<Person>): Promise<void> {
        const s = this.someone;

        if (s.identities.has(identity)) {
            throw new Error('This identity is already managed by this someone object');
        }

        s.identities.set(identity, new Set());
        await this.saveAndLoad();
    }

    /**
     * Remove an identity to the someone object
     *
     * @param identity
     */
    public async removeIdentity(identity: SHA256IdHash<Person>): Promise<void> {
        const s = this.someone;

        if (!s.identities.has(identity)) {
            throw new Error('This identity is not managed by this someone object');
        }

        s.identities.delete(identity);
        await this.saveAndLoad();
    }

    /**
     * Get all identities managed by this someone object.
     */
    public identities(): SHA256IdHash<Person>[] {
        return [...this.someone.identities.keys()];
    }

    /**
     * Checks whether this identity is managed by this someone object.
     *
     * @param identity
     */
    public managesIdentity(identity: SHA256IdHash<Person>): boolean {
        return this.identities().includes(identity);
    }

    /**
     * Retrieve the main identity by looking it up in the main profile.
     */
    public async mainIdentity(): Promise<SHA256IdHash<Person>> {
        return (await this.mainProfile()).personId;
    }

    /**
     * Retrieve all identities managed by this someone object except the main identity.
     */
    public async alternateIdentities(): Promise<SHA256IdHash<Person>[]> {
        const mainIdentity = await this.mainIdentity();
        return this.identities().filter(id => id !== mainIdentity);
    }

    /**
     * Sets the main identity by guessing which profile to use as mainProfile
     *
     * @param identity
     */
    public async setMainIdentity(identity: SHA256IdHash<Person>): Promise<void> {
        const s = this.someone;

        const mainIdentity = await this.mainIdentity();

        if (identity === mainIdentity) {
            return;
        }

        if (!s.identities.has(identity)) {
            throw new Error(
                'The designated new main identity is not managed by this someone object'
            );
        }

        const profiles = await this.profiles(identity);

        if (profiles.length === 0) {
            throw new Error('We have no profiles to assign as main profile :-(');
        }

        // FIRST CHOICE: A 'default' profile that is owned by the person itself
        const firstChoice = profiles.find(
            profile => profile.profileId === 'default' && profile.owner === identity
        );

        if (firstChoice !== undefined) {
            s.mainProfile = firstChoice.idHash;
            await this.saveAndLoad();
            return;
        }

        // SECOND CHOICE: Another 'default' profile
        for (const profile of profiles) {
            if (profile.profileId === 'default') {
                s.mainProfile = profile.idHash;
                await this.saveAndLoad();
                return;
            }
        }

        // THIRD CHOICE: Any other profile
        s.mainProfile = profiles[0].idHash;
        await this.saveAndLoad();
    }

    // ######## Main profile management ########

    public mainProfile(): Promise<ProfileModel> {
        return ProfileModel.constructFromLatestVersion(this.someone.mainProfile);
    }

    public mainProfileLazyLoad(): ProfileModel {
        return new ProfileModel(this.someone.mainProfile);
    }

    /**
     * Set the main profile.
     *
     * Throws if the identity referenced by this profile is not managed by this someone object.
     *
     * @param profile
     */
    public async setMainProfile(profile: SHA256IdHash<Profile>): Promise<void> {
        const s = this.someone;

        if (s.mainProfile === undefined) {
            throw new Error('SomeoneModel has no data (mainProfile)');
        }

        const profileObj = await getIdObject(profile);
        const profileSet = s.identities.get(profileObj.personId);

        if (profileSet === undefined) {
            throw new Error(
                'This someone object does not manage the identity of the passed profile.'
            );
        }

        s.mainProfile = profile;

        profileSet.add(profile);
        await this.saveAndLoad();
    }

    /**
     * Set the main profile only when the saved profile is not the main profile.
     *
     * Throws if the identity referenced by this profile is not managed by this someone object.
     *
     * @param profile
     */
    public async setMainProfileIfNotDefault(profile: SHA256IdHash<Profile>): Promise<void> {
        const s = this.someone;

        const profileObj = await getIdObject(profile);
        const profileSet = s.identities.get(profileObj.personId);

        if (profileSet === undefined) {
            throw new Error(
                'This someone object does not manage the identity of the passed profile.'
            );
        }

        const mainProfileObj = await getIdObject(s.mainProfile);

        if (mainProfileObj.profileId === 'default') {
            return;
        }

        if (profileObj.profileId !== 'default') {
            return;
        }

        s.mainProfile = profile;

        profileSet.add(profile);
    }

    // ######## Profile management ########

    /**
     * Get the profiles managed by this someone object.
     *
     * @param identity
     */
    public async profiles(identity?: SHA256IdHash<Person>): Promise<ProfileModel[]> {
        const profiles = this.profilesLazyLoad(identity);
        await Promise.all(profiles.map(profile => profile.loadLatestVersion()));
        return profiles;
    }

    /**
     * Get the profiles managed by this someone object.
     *
     * Note that this will return ProfileModel instances that have no data in them. You have to use
     * loadLatestVersion on it in order to get the data.
     *
     * @param identity - Get the profiles only for this identity. If not specified, get all profiles
     *                   for all identities managed by this someone object.
     */
    public profilesLazyLoad(identity?: SHA256IdHash<Person>): ProfileModel[] {
        const s = this.someone;

        const profileHashes = [];

        // Collect all SHA256IdHash<Profile> hashes for the picked identities (or all)
        if (identity === undefined) {
            for (const profiles of s.identities.values()) {
                profileHashes.push(...profiles);
            }
        } else {
            const profiles = s.identities.get(identity);
            if (profiles === undefined) {
                throw new Error('This identity is not managed by this someone object');
            }
            profileHashes.push(...profiles);
        }

        // Load all profile objects
        return profileHashes.map(profileIdHash => new ProfileModel(profileIdHash));
    }

    /**
     * Add a profile to this someone object.
     */
    public async addProfile(profile: SHA256IdHash<Profile>): Promise<void> {
        const s = this.someone;

        const profileObj = await getObjectByIdHash(profile);
        const profileSet = s.identities.get(profileObj.obj.personId);

        if (profileSet === undefined) {
            throw new Error('The someone object does not manage profiles for the specified person');
        }

        profileSet.add(profile);

        await this.saveAndLoad();
    }

    /**
     * Remove a profile to this someone object.
     */
    public async removeProfile(profile: SHA256IdHash<Profile>): Promise<void> {
        const profileObj = await getObjectByIdHash(profile);
        const profileSet = this.someone.identities.get(profileObj.obj.personId);

        if (profileSet === undefined) {
            throw new Error('The someone object does not manage profiles for the specified person');
        }

        profileSet.delete(profile);

        await this.saveAndLoad();
    }

    /**
     * Create a new profile for a specific person.
     *
     * @param profileId
     * @param personId
     * @param owner
     * @param communicationEndpoints
     * @param personDescriptions
     */
    public async createProfile(
        profileId: string,
        personId: SHA256IdHash<Person>,
        owner: SHA256IdHash<Person>,
        communicationEndpoints: CommunicationEndpointTypes[] = [],
        personDescriptions: PersonDescriptionTypes[] = []
    ): Promise<ProfileModel> {
        const profile = await ProfileModel.constructWithNewProfile(
            personId,
            owner,
            profileId,
            communicationEndpoints,
            personDescriptions
        );
        await this.addProfile(profile.idHash);
        return profile;
    }

    // ######## Save & Load ########

    /**
     * Returns whether this model has data loaded.
     *
     * If this returns false, then the 'hash', 'profileId' ... properties will throw when being
     * accessed.
     */
    public hasData(): boolean {
        return this.pSomeone !== undefined;
    }

    /**
     * Load a specific someone version.
     *
     * @param version
     */
    public async loadVersion(version: SHA256Hash<Someone>): Promise<void> {
        const someone = await getObject(version);

        const idHash = await calculateIdHashOfObj(someone);
        if (idHash !== this.idHash) {
            throw new Error('Specified someone version is not a version of the managed someone');
        }

        this.pSomeone = someone;
    }

    /**
     * Load the latest someone version.
     */
    public async loadLatestVersion(): Promise<void> {
        this.pSomeone = (await getObjectByIdHash(this.idHash)).obj;
    }

    /**
     * Save the someone to disk and load the latest version.
     *
     * Why is there no pure save() function? The cause are crdts. The object that is eventually
     * written to disk might differ from the current state of this instance. This happens when new
     * data was received via chum since the last load. This means that we don't have a hash
     * representing the current state.
     */
    public async saveAndLoad(): Promise<void> {
        if (this.pSomeone === undefined) {
            throw new Error('No someone data that could be saved');
        }

        this.pSomeone = (await storeVersionedObject(this.pSomeone)).obj;
    }

    // ######## misc ########

    /**
     * Return all endpoints from all profiles.
     */
    public async collectAllEndpointsOfType<T extends CommunicationEndpointTypeNames>(
        type: T,
        identity?: SHA256IdHash<Person>
    ): Promise<CommunicationEndpointInterfaces[T][]> {
        const endpoints = [];
        for (const profile of await this.profiles(identity)) {
            endpoints.push(...profile.endpointsOfType(type));
        }
        return endpoints;
    }

    /**
     * Return all descriptions from all profiles.
     */
    public async collectAllDescriptionsOfType<T extends PersonDescriptionTypeNames>(
        type: T,
        identity?: SHA256IdHash<Person>
    ): Promise<PersonDescriptionInterfaces[T][]> {
        const descriptions = [];
        for (const profile of await this.profiles(identity)) {
            descriptions.push(...profile.descriptionsOfType(type));
        }
        return descriptions;
    }

    public async getMainProfileDisplayName(): Promise<string> {
        try {
            const profile = await this.mainProfile();
            const personNames = profile.descriptionsOfType('PersonName');
            if (personNames.length === 0) {
                return 'undefined';
            }
            return personNames[0].name;
        } catch (_) {
            return 'undefined';
        }
    }

    public async getDefaultProfileDisplayNames(
        myId: SHA256IdHash<Person>
    ): Promise<Map<SHA256IdHash<Person>, string>> {
        const map = new Map<SHA256IdHash<Person>, string>();

        for (const [identity, profiles] of this.someone.identities.entries()) {
            const name = await this.getDefaultProfileDisplayNameFromProfiles([...profiles], myId);
            if (name !== undefined) {
                map.set(identity, name);
            }
        }

        return map;
    }

    /**
     * Get the profile name from one of the default profiles.
     *
     * It will first try to find the profile that we edited (I am owner).
     * Then it will try to find the profile that the person itself edited (He is owner)
     * Then it will look for a default profile from any owner.
     *
     * @param identity
     * @param myId - This needs to be my own main identity, because profiles with this owner
     * will supersede the other profiles.
     */
    public async getDefaultProfileDisplayName(
        identity: SHA256IdHash<Person>,
        myId: SHA256IdHash<Person>
    ): Promise<string> {
        const profiles = this.someone.identities.get(identity);

        if (profiles === undefined) {
            return identity;
        }

        const name = await this.getDefaultProfileDisplayNameFromProfiles([...profiles], myId);

        return name === undefined ? identity : name;
    }

    private async getDefaultProfileDisplayNameFromProfiles(
        profileHashes: SHA256IdHash<Profile>[],
        myId: SHA256IdHash<Person>
    ): Promise<string | undefined> {
        try {
            const profileIdObjs = await Promise.all(
                profileHashes.map(idHash => getIdObject<Profile>(idHash))
            );
            const defaultProfileIdObjs = profileIdObjs.filter(
                profile => profile.profileId === 'default'
            );
            const defaultProfiles = await Promise.all(
                defaultProfileIdObjs.map(async idObj =>
                    ProfileModel.constructFromLatestVersionByIdFields(
                        idObj.personId,
                        idObj.owner,
                        idObj.profileId
                    )
                )
            );

            const meOwner = SomeoneModel.getPersonNameFromFilteredProfiles(
                defaultProfiles,
                profile => profile.owner === myId
            );

            if (meOwner !== undefined) {
                return meOwner;
            }

            const selfOwner = SomeoneModel.getPersonNameFromFilteredProfiles(
                defaultProfiles,
                profile => profile.owner === profile.personId
            );

            if (selfOwner !== undefined) {
                return selfOwner;
            }

            const anyOwner = SomeoneModel.getPersonNameFromFilteredProfiles(
                defaultProfiles,
                _profile => true
            );

            if (anyOwner !== undefined) {
                return anyOwner;
            }

            return undefined;
        } catch (_) {
            return undefined;
        }
    }

    // ######## private stuff ########

    /**
     * Get the person name from the first profile that matches the predicate.
     *
     * @param profiles
     * @param predicate
     * @private
     */
    private static getPersonNameFromFilteredProfiles(
        profiles: ProfileModel[],
        predicate: (profile: ProfileModel) => boolean
    ): string | undefined {
        const filteredProfiles = profiles.filter(predicate);
        for (const profile of filteredProfiles) {
            const personNames = profile.descriptionsOfType('PersonName');
            if (personNames.length > 0) {
                return personNames[0].name;
            }
        }
        return undefined;
    }
}
