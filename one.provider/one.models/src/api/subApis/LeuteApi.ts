import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';

import type {LeuteApiInitConfig, LeuteApiType, ModelsHelperType, OneApi} from '../utils/types.js';
import SomeoneModel from '../../models/Leute/SomeoneModel.js';
import ProfileModel from '../../models/Leute/ProfileModel.js';
import GroupModel from '../../models/Leute/GroupModel.js';
import type {Someone} from '../../recipes/Leute/Someone.js';
import type {Profile} from '../../recipes/Leute/Profile.js';
import type {ProfileImage} from '../../recipes/Leute/PersonDescriptions.js';

type PersonInfo = {
    personId: SHA256IdHash<Person>;
    name: string;
    email: string | undefined;
    profilePicture: ProfileImage | undefined;
    someone: SomeoneModel;
    profile: ProfileModel;
};

/**
 * Leute data structure:
 * - Someone
 *      Used as a container for identities and profiles.
 *      Usually querryed by identity (personId).
 *      There is a Model for managing the someone easier.
 * - Profile
 *      A profile is always linked to an identity.
 *      There aways is at least one profile, considered the main/default profile.
 *      The profile contains/could contain an identity's name, picture, email, birthday, etc, known as PersonDescriptions.
 *      .owner is the one who created it, while .personId is the identity of the profile.
 *      There is a Model for managing the profile easier.
 * - Identity (also called a Person/personId)
 *      A identity is always linked to a someone.
 *      There aways is at least one identity per someone, considered the main identity.
 *      Most data in One is linked to an identity (personId), the one who creates it.
 *      A identity can have multiple profiles, for example a main and a work profile.
 * - Group
 *      A group is a collection of identities (persons)
 *      A identity (person) can be part of multiple groups.
 *      A group can be in the leute list or external to the leute list.
 *      There is a Model for managing the group easier.
 */
export default class LeuteApi implements LeuteApiType {
    private oneApi: OneApi;
    private models: ModelsHelperType;
    private initialPeers: SHA256IdHash<Person>[];

    constructor(oneApi: OneApi, models: ModelsHelperType) {
        this.oneApi = oneApi;
        this.models = models;
        this.initialPeers = [];
    }

    public init(config: LeuteApiInitConfig): void {
        if (config.initialPeers) {
            config.initialPeers.forEach(peer => {
                this.initialPeers.push(peer);
            });
        }
    }

    public shutdown(): void {
        this.initialPeers = [];
    }

    /**
     * Get the name of a person.
     * @param personId - The person to get the name of.
     * @returns The name of the person.
     */
    public getPersonName(personId: SHA256IdHash<Person>): string {
        return this.models.getLeuteModel().getPersonName(personId);
    }

    /**
     * Get the pictures of a person.
     * @param personId - The person to get the pictures of.
     * @returns The pictures of the person.
     */
    public async getPersonProfilePictures(personId: SHA256IdHash<Person>): Promise<ProfileImage[]> {
        const profile = await this.models.getLeuteModel().getMainProfile(personId);

        return profile.descriptionsOfType('ProfileImage');
    }

    /**
     * Get the profile picture of a person.
     * @param personId - The person to get the picture of.
     * @returns The picture of the person or undefined if no picture is found.
     */
    public async getPersonProfilePicture(
        personId: SHA256IdHash<Person>
    ): Promise<ProfileImage | undefined> {
        const images = await this.getPersonProfilePictures(personId);
        const profileImage = images[images.length - 1];
        if (profileImage !== undefined) {
            return profileImage;
        }

        return undefined;
    }

    /**
     * Get the picture of a profile.
     * @param profileId - The profile to get the picture of.
     * @returns The picture of the profile or undefined if no picture is found.
     */
    public async getProfilePicture(
        profileId: SHA256IdHash<Profile>
    ): Promise<ProfileImage | undefined> {
        const profile = await ProfileModel.constructFromLatestVersion(profileId);
        const images = profile.descriptionsOfType('ProfileImage');
        const profileImage = images[images.length - 1];
        if (profileImage !== undefined) {
            return profileImage;
        }

        return undefined;
    }

    /**
     * Get everyone.
     * @returns Everyone.
     */
    public async getEveryone(): Promise<SomeoneModel[]> {
        return [
            await this.models.getLeuteModel().me(),
            ...(await this.models.getLeuteModel().others())
        ];
    }

    /**
     * Get everyone else except the current user.
     * @returns Everyone else except the current user.
     */
    public async getEveryoneElse(): Promise<SomeoneModel[]> {
        return await this.models.getLeuteModel().others();
    }

    /**
     * Get everyone else except the current user and the person with the given personId.
     * @param personId - The person to exclude.
     * @returns Everyone else except the current user and the person with the given personId.
     */
    public async getEveryoneElseExcept(personId: SHA256IdHash<Person>): Promise<SomeoneModel[]> {
        const everyoneElse = await this.getEveryoneElse();
        return everyoneElse.filter(person => !person.managesIdentity(personId));
    }

    /**
     * Get everyone else except the initial peers.
     * @returns Everyone else except the initial peers.
     */
    public async getEveryoneElseExceptInitialPeers(): Promise<SomeoneModel[]> {
        const everyoneElse = await this.getEveryoneElse();
        return everyoneElse.filter(someone => {
            for (const peer of this.initialPeers) {
                if (someone.managesIdentity(peer)) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * Get the initial peers.
     * @returns The initial peers.
     */
    public async getInitialPeers(): Promise<SomeoneModel[]> {
        const peerSomeones: SomeoneModel[] = [];

        for (const peer of this.initialPeers) {
            const someone = await this.models.getLeuteModel().getSomeone(peer);
            if (someone !== undefined) {
                peerSomeones.push(someone);
            }
        }

        return peerSomeones;
    }

    /**
     * Get the main identity of the current user.
     * @returns The main identity of the current user.
     */
    public async getMyMainIdentity(): Promise<SHA256IdHash<Person>> {
        return await this.models.getLeuteModel().myMainIdentity();
    }

    /**
     * Get the main profile of the current user.
     * @returns The main profile of the current user.
     */
    public async getMyMainProfile(): Promise<ProfileModel> {
        const me = await this.models.getLeuteModel().me();
        return me.mainProfile();
    }

    /**
     * Get the main profile of a person.
     * @throws If the person is not found.
     * @param personId - The person to get the main profile of.
     * @returns The main profile of the person.
     */
    public async getMainProfile(personId: SHA256IdHash<Person>): Promise<ProfileModel> {
        const someone = await this.models.getLeuteModel().getSomeone(personId);
        if (someone === undefined) {
            throw new Error('Person not found');
        }
        return someone.mainProfile();
    }

    /**
     * Get all groups.
     * @returns All groups.
     */
    public async getGroups(): Promise<GroupModel[]> {
        return await this.models.getLeuteModel().groups();
    }

    /**
     * Get a group by name.
     * @param groupName - The name of the group.
     * @returns The group.
     */
    public async getGroup(groupName: string): Promise<GroupModel> {
        return GroupModel.constructFromLatestProfileVersionByGroupName(groupName);
    }

    /**
     * Get the members of a group.
     * @param groupName - The name of the group.
     * @returns An array of objects with the personId and the name of the person.
     */
    public async getGroupMembers(
        groupName: string
    ): Promise<{personId: SHA256IdHash<Person>; name: string}[]> {
        const group = await this.getGroup(groupName);
        return group.persons.map(person => ({
            personId: person,
            name: this.models.getLeuteModel().getPersonName(person)
        }));
    }

    /**
     * Add a new group to the leute list. Note: a group can be external to the leute list.
     * @param name - The name of the group. Note: could be an existing group name, otherwise a new group will be created.
     * @returns The new group.
     */
    public async addGroup(name: string): Promise<GroupModel> {
        return await this.models.getLeuteModel().createGroup(name);
    }

    /**
     * Create a new someone.
     * @returns The new someone.
     */
    public async createSomeone(): Promise<SomeoneModel> {
        return SomeoneModel.constructFromLatestVersion(
            await this.models.getLeuteModel().createSomeoneWithShallowIdentity()
        );
    }

    /**
     * Create a new profile for a person.
     * @param personId - The person to create the profile for.
     * @returns The new profile.
     */
    public async createProfile(personId: SHA256IdHash<Person>): Promise<ProfileModel> {
        return this.models.getLeuteModel().createProfileForPerson(personId);
    }

    /**
     * Get the profiles of a person/someone.
     * @param personId - The personId of the someone.
     * @param all - If true, get all profiles to the someone, otherwise get only the personId profile.
     * @returns The profiles of the person/someone.
     */
    public async getProfiles(
        personId: SHA256IdHash<Person>,
        all: boolean = false
    ): Promise<ProfileModel[]> {
        const someone = await this.models.getLeuteModel().getSomeone(personId);
        if (someone === undefined) {
            throw new Error('Person not found');
        }
        if (all) {
            return someone.profiles();
        }
        return someone.profiles(personId);
    }

    /**
     * Get the identities of a someone.
     * @param personId - The personId of the someone.
     * @returns The identities of the someone.
     */
    public async getSomeoneIdentities(
        personId: SHA256IdHash<Person>
    ): Promise<SHA256IdHash<Person>[]> {
        const someone = await this.models.getLeuteModel().getSomeone(personId);
        if (someone === undefined) {
            throw new Error('Person not found');
        }
        return someone.identities();
    }

    /**
     * Create a new identity for someone.
     * @param someoneId - The someone to create the identity for.
     * @param email - The email of the identity.
     * @returns The new identity.
     */
    public async createIdentity(
        someoneId: SHA256IdHash<Someone>,
        email?: string
    ): Promise<ProfileModel> {
        return this.models.getLeuteModel().createShallowIdentityForSomeone(someoneId, email);
    }

    /**
     * Remove a person you know.
     * @param someoneId - The someone to remove.
     */
    public async removeSomeone(someoneId: SHA256IdHash<Someone>): Promise<void> {
        return this.models.getLeuteModel().removeSomeoneElse(someoneId);
    }

    /**
     * Get the person information of everyone else.
     * @returns The person information of everyone else.
     */
    public async getEveryoneElseInfo(): Promise<PersonInfo[]> {
        const others = await this.getEveryoneElse();

        return Promise.all(
            others.map(async someone => this.getPersonInfo(await someone.mainIdentity()))
        );
    }

    /**
     * Get my information.
     * @returns My information.
     */
    public async getMyInfo(): Promise<PersonInfo> {
        return this.getPersonInfo(await this.getMyMainIdentity());
    }

    /**
     * Get the person information.
     * @param personId - The person to get.
     * @returns The person information.
     */
    public async getPersonInfo(personId: SHA256IdHash<Person>): Promise<PersonInfo> {
        const someone = await this.models.getLeuteModel().getSomeone(personId);
        if (someone === undefined) {
            throw new Error('Someone not found');
        }
        const mainProfile = await this.getMainProfile(personId);
        return {
            personId: await someone.mainIdentity(),
            name: this.getPersonName(personId),
            email: await this.getPersonEmail(personId),
            profilePicture: mainProfile.descriptionsOfType('ProfileImage')[0],
            someone: someone,
            profile: mainProfile
        };
    }

    /**
     * Get the email of a person.
     * @param personId - The person to get the email of.
     * @returns The email of the person.
     */
    public async getPersonEmail(personId: SHA256IdHash<Person>): Promise<string | undefined> {
        const profile = await this.models.getLeuteModel().getMainProfile(personId);
        if (profile === undefined) {
            throw new Error('Profile not found');
        }

        return profile.communicationEndpoints.find(endpoint => endpoint.$type$ === 'Email')?.email;
    }
}
