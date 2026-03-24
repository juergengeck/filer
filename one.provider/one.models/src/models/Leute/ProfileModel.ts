import type {VersionedObjectResult} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {
    getObjectByIdHash,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {
    getObject,
    storeUnversionedObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {BLOB} from '@refinio/one.core/lib/recipes.js';

import {objectEvents} from '../../misc/ObjectEventDispatcher.js';
import type {Profile} from '../../recipes/Leute/Profile.js';
import type {
    CommunicationEndpointTypes,
    CommunicationEndpointTypeNames,
    CommunicationEndpointInterfaces
} from '../../recipes/Leute/CommunicationEndpoints.js';
import type {
    PersonDescriptionInterfaces,
    PersonDescriptionTypeNames,
    PersonDescriptionTypes,
    PersonImage,
    PersonStatus
} from '../../recipes/Leute/PersonDescriptions.js';
import {OEvent} from '../../misc/OEvent.js';
import {isEndpointOfType} from '../../recipes/Leute/CommunicationEndpoints.js';
import {isDescriptionOfType} from '../../recipes/Leute/PersonDescriptions.js';

/**
 * This class is a nicer frontend for the Profile recipe.
 *
 * A profile describes a persons identity in more detail. What is an identity in one? The identity
 * used throughout ONE is the SHA256IdHash<Person>. The profile glues additional information to such
 * an identity like:
 * - how to contact this person (e-mail, telephone number, address, ...) - called "contact endpoint"
 * - name, pictures ... - called "contact description"
 *
 * Reasons for not using the Profile recipe directly:
 * - Because this is a CRDT tracked type we need to track which version was loaded, so on which
 *   versions the modifications are based on. If we don't store it with the data we need to track it
 *   separately. Perhaps in the future we can find some common solution for all recipes. This is
 *   just the first test if having a separate data structure adds some value to the ui.
 * - The endpoints and descriptions are links to ONE objects. If you want to use the recipe directly
 *   you would have to load them in the ui context asynchronously - which would result in a data
 *   structure very similar to this - so why not do it here directly?
 * - Changes in the recipe can be represented on this level without breaking API changes.
 *
 * There are alternative designs. I just want to try this approach because of the reasons mentioned
 * above. This might be a start on how to represent CRDT managed types - but later in a generic way.
 */
export default class ProfileModel {
    public onUpdate: OEvent<() => void> = new OEvent();

    public readonly idHash: SHA256IdHash<Profile>;
    public communicationEndpoints: CommunicationEndpointTypes[] = [];
    public personDescriptions: PersonDescriptionTypes[] = [];
    public isStatusModified = false;
    public isImageModified = false;

    private pLoadedVersion?: SHA256Hash<Profile>;
    private profile?: Profile;

    /**
     * Construct a new Profile wrapper on a profile identity.
     */
    constructor(idHash: SHA256IdHash<Profile>) {
        this.idHash = idHash;

        // Setup the onUpdate event
        let disconnect: (() => void) | undefined;
        this.onUpdate.onListen(() => {
            if (this.onUpdate.listenerCount() === 0) {
                disconnect = objectEvents.onNewVersion(
                    async () => {
                        await this.onUpdate.emitAll();
                    },
                    `ProfileModel: onUpdate ${this.idHash}`,
                    'Profile'
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
     * Construct a new ProfileModel with a specific version loaded.
     */
    public static async constructFromResult(
        result: VersionedObjectResult<Profile>
    ): Promise<ProfileModel> {
        const newModel = new ProfileModel(result.idHash);
        await newModel.updateModelDataFromProfile(result.obj, result.hash);
        return newModel;
    }

    /**
     * Construct a new ProfileModel with a specific version loaded.
     */
    public static async constructFromVersion(version: SHA256Hash<Profile>): Promise<ProfileModel> {
        const profile = await getObject(version);
        const idHash = await calculateIdHashOfObj(profile);
        const newModel = new ProfileModel(idHash);
        await newModel.updateModelDataFromProfile(profile, version);
        return newModel;
    }

    /**
     * Construct a new ProfileModel with the latest version loaded.
     */
    public static async constructFromLatestVersion(
        idHash: SHA256IdHash<Profile>
    ): Promise<ProfileModel> {
        const newModel = new ProfileModel(idHash);
        await newModel.loadLatestVersion();
        return newModel;
    }

    public static async constructFromLatestVersionByIdFields(
        personId: SHA256IdHash<Person>,
        owner: SHA256IdHash<Person>,
        profileId: string
    ) {
        const idHash = await calculateIdHashOfObj({
            $type$: 'Profile',
            personId,
            owner,
            profileId
        });
        const loadedModel = new ProfileModel(idHash);
        await loadedModel.loadLatestVersion();
        return loadedModel;
    }

    /**
     * Create a profile if it does not exist.
     *
     * If you specify descriptions and / or endpoints here and a profile version already exists
     * without those endpoints and / or descriptions it will add them again.
     *
     * @param personId
     * @param owner
     * @param profileId
     * @param communicationEndpoints
     * @param personDescriptions
     * @returns The latest version of the profile or an empty profile.
     */
    public static async constructWithNewProfile(
        personId: SHA256IdHash<Person>,
        owner: SHA256IdHash<Person>,
        profileId: string,
        communicationEndpoints: CommunicationEndpointTypes[] = [],
        personDescriptions: PersonDescriptionTypes[] = []
    ): Promise<ProfileModel> {
        const newProfile: Profile = {
            $type$: 'Profile',
            personId,
            owner,
            profileId,
            communicationEndpoint: [],
            personDescription: []
        };
        const idHash = await calculateIdHashOfObj(newProfile);

        const newModel = new ProfileModel(idHash);
        newModel.profile = newProfile;
        newModel.communicationEndpoints = communicationEndpoints;
        newModel.personDescriptions = personDescriptions;
        await newModel.saveAndLoad();
        return newModel;
    }

    // ######## getter ########

    get loadedVersion(): SHA256Hash<Profile> | undefined {
        return this.pLoadedVersion;
    }

    get profileId(): string {
        if (this.profile === undefined) {
            throw new Error('ProfileModel has no data (profileId)');
        }
        return this.profile.profileId;
    }

    get personId(): SHA256IdHash<Person> {
        if (this.profile === undefined) {
            throw new Error('ProfileModel has no data (personId)');
        }
        return this.profile.personId;
    }

    get owner(): SHA256IdHash<Person> {
        if (this.profile === undefined) {
            throw new Error('ProfileModel has no data (owner)');
        }
        return this.profile.owner;
    }

    get nickname(): string | undefined {
        if (this.profile === undefined) {
            throw new Error('ProfileModel has no data (nickname)');
        }
        return this.profile.nickname;
    }

    set nickname(value: string | undefined) {
        if (this.profile === undefined) {
            throw new Error('ProfileModel has no data (nickname)');
        }
        this.profile.nickname = value;
    }

    // ######## Endpoint & Description convenience functions ########

    /**
     * Return all endpoints of a specific type from this.communicationEndpoints.
     *
     * You can modify the returned objects in-place and then save the profile in order to update
     * the profile.
     */
    public endpointsOfType<T extends CommunicationEndpointTypeNames>(
        type: T
    ): CommunicationEndpointInterfaces[T][] {
        const endpoints = [];
        for (const endpoint of this.communicationEndpoints) {
            if (isEndpointOfType(endpoint, type)) {
                endpoints.push(endpoint);
            }
        }
        return endpoints;
    }

    /**
     * Return all descriptions of a specific type from this.contactDescriptions.
     *
     * You can modify the returned objects in-place and then save the profile in order to update
     * the profile.
     */
    public descriptionsOfType<T extends PersonDescriptionTypeNames>(
        type: T
    ): PersonDescriptionInterfaces[T][] {
        const descriptions = [];
        for (const endpoint of this.personDescriptions) {
            if (isDescriptionOfType(endpoint, type)) {
                descriptions.push(endpoint);
            }
        }
        return descriptions;
    }

    public getStatus(): PersonStatus {
        const statuses = this.descriptionsOfType('PersonStatus');
        return statuses.reduce(
            (status: PersonStatus, latestStatus: PersonStatus) =>
                status.timestamp > latestStatus.timestamp ? status : latestStatus,
            statuses[0]
        );
    }

    public setStatus(statusValue: string, location: string): void {
        if (!this.isStatusModified) {
            this.personDescriptions.push({
                $type$: 'PersonStatus',
                timestamp: Date.now(),
                value: statusValue,
                location: location
            });
            this.isStatusModified = true;
            return;
        }

        const latestStatus = this.getStatus();
        latestStatus.value = statusValue;
        latestStatus.location = location;
        latestStatus.timestamp = Date.now();
    }

    public getImage(): PersonImage {
        const images = this.descriptionsOfType('PersonImage');
        return images.reduce(
            (image1: PersonImage, image2: PersonImage) =>
                image1.timestamp > image2.timestamp ? image1 : image2,
            images[0]
        );
    }

    public setImage(image: SHA256Hash<BLOB>, location: string): void {
        if (!this.isImageModified) {
            this.personDescriptions.push({
                $type$: 'PersonImage',
                timestamp: Date.now(),
                image: image,
                location: location
            });
            this.isImageModified = true;
            return;
        }

        const latestImage = this.getImage();
        latestImage.image = image;
        latestImage.location = location;
        latestImage.timestamp = Date.now();
    }

    // ######## Save & Load ########

    /**
     * Returns whether this model has data loaded.
     *
     * If this returns false, then the 'personId', 'profileId' and 'owner' properties will throw and
     * endpoints and descriptions will be empty arrays (if they haven't been modified from the
     * outside)
     */
    public hasData(): boolean {
        return this.profile !== undefined;
    }

    /**
     * Load a specific profile version.
     *
     * @param version
     */
    public async loadVersion(version: SHA256Hash<Profile>): Promise<void> {
        const profile = await getObject(version);

        const idHash = await calculateIdHashOfObj(profile);
        if (idHash !== this.idHash) {
            throw new Error('Specified profile version is not a version of the managed profile');
        }

        await this.updateModelDataFromProfile(profile, version);
    }

    /**
     * Load the latest profile version.
     */
    public async loadLatestVersion(): Promise<void> {
        const result = await getObjectByIdHash(this.idHash);

        await this.updateModelDataFromProfile(result.obj, result.hash);
    }

    /**
     * Save the profile to disk and load the latest version.
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
    public async saveAndLoad(): Promise<void> {
        if (this.profile === undefined) {
            throw new Error('No profile data that could be saved');
        }

        // Write endpoint and description objects
        const epHashes = await Promise.all(
            this.communicationEndpoints.map(ep => storeUnversionedObject(ep))
        );
        const descHashes = await Promise.all(
            this.personDescriptions.map(desc => storeUnversionedObject(desc))
        );

        // Write the new profile version
        const result = await storeVersionedObject({
            $type$: 'Profile',
            $versionHash$: this.profile.$versionHash$,
            profileId: this.profile.profileId,
            personId: this.profile.personId,
            owner: this.profile.owner,
            nickname: this.profile.nickname,
            communicationEndpoint: epHashes.map(ep => ep.hash),
            personDescription: descHashes.map(desc => desc.hash)
        });

        await this.updateModelDataFromProfile(result.obj, result.hash);

        this.onUpdate.emit();
    }

    // ######## private stuff ########

    /**
     * Updates the members of the model based on a loaded profile and the version hash.
     *
     * @param profile
     * @param version
     * @private
     */
    private async updateModelDataFromProfile(
        profile: Profile,
        version: SHA256Hash<Profile>
    ): Promise<void> {
        const communicationEndpoints = await Promise.all(
            profile.communicationEndpoint.map(ep => getObject(ep))
        );
        const personDescriptions = await Promise.all(
            profile.personDescription.map(ep => getObject(ep))
        );

        // Do the assignment at the end to get strong exception safety
        this.communicationEndpoints = communicationEndpoints;
        this.personDescriptions = personDescriptions;
        this.pLoadedVersion = version;
        this.profile = profile;
        this.isStatusModified = false;
        this.isImageModified = false;
    }
}
