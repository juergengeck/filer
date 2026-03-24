import type {BLOB, Group, Person} from '@refinio/one.core/lib/recipes.js';
import {readBlobAsArrayBuffer} from '@refinio/one.core/lib/storage-blob.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {
    getObjectByIdHash,
    getObjectByIdObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {createRandomString} from '@refinio/one.core/lib/system/crypto-helpers.js';
import {createFileWriteStream} from '@refinio/one.core/lib/system/storage-streams.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {objectEvents} from '../../misc/ObjectEventDispatcher.js';
import type {GroupProfile} from '../../recipes/Leute/GroupProfile.js';
import {Model} from '../Model.js';
import {OEvent} from '../../misc/OEvent.js';

const DUMMY_BLOB_HASH = '0'.repeat(64) as SHA256Hash<BLOB>;

export default class GroupModel extends Model {
    public readonly groupIdHash: SHA256IdHash<Group>;
    public readonly profileIdHash: SHA256IdHash<GroupProfile>;

    public onUpdated: OEvent<
        (added?: SHA256IdHash<Person>[], removed?: SHA256IdHash<Person>[]) => void
    > = new OEvent<(oldList: SHA256IdHash<Person>[], newList: SHA256IdHash<Person>[]) => void>();
    public name: string = 'unnamed group';
    public picture?: ArrayBuffer;
    public persons: SHA256IdHash<Person>[] = [];

    private pLoadedVersion?: SHA256Hash<GroupProfile>;
    private group?: Group;
    private profile?: GroupProfile;

    constructor(groupIdHash: SHA256IdHash<Group>, profileIdHash: SHA256IdHash<GroupProfile>) {
        super();
        this.profileIdHash = profileIdHash;
        this.groupIdHash = groupIdHash;

        // Setup the onUpdate event
        let disconnect: (() => void) | undefined;
        this.onUpdated.onListen(() => {
            if (this.onUpdated.listenerCount() === 0) {
                const d1 = objectEvents.onNewVersion(
                    async () => {
                        await this.onUpdated.emitAll();
                    },
                    `GroupModel: onUpdate Group ${this.groupIdHash}`,
                    'Group',
                    this.groupIdHash
                );
                const d2 = objectEvents.onNewVersion(
                    async () => {
                        await this.onUpdated.emitAll();
                    },
                    `GroupModel: onUpdate GroupProfile ${this.profileIdHash}`,
                    'GroupProfile',
                    this.profileIdHash
                );
                disconnect = () => {
                    d1();
                    d2();
                };
            }
        });
        this.onUpdated.onStopListen(() => {
            if (this.onUpdated.listenerCount() === 0) {
                if (disconnect !== undefined) {
                    disconnect();
                    disconnect = undefined;
                }
            }
        });

        this.state.assertCurrentState('Uninitialised');
        this.state.triggerEvent('init');
    }

    async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');
        this.state.triggerEvent('shutdown');
    }

    // ######## asynchronous constructors ########

    /**
     * Construct a new GroupModel with a specific version loaded.
     */
    public static async constructFromProfileVersion(
        version: SHA256Hash<GroupProfile>
    ): Promise<GroupModel> {
        const profile = await getObject(version);
        const profileIdHash = await calculateIdHashOfObj(profile);
        const group = await getObjectByIdHash(profile.group);
        const newModel = new GroupModel(profile.group, profileIdHash);
        await newModel.updateModelDataFromGroupAndProfile(group.obj, profile, version);
        return newModel;
    }

    /**
     * Construct a new GroupModel with the latest version loaded.
     */
    public static async constructFromLatestProfileVersion(
        groupIdHash: SHA256IdHash<Group>
    ): Promise<GroupModel> {
        const profileIdHash = await calculateIdHashOfObj({
            $type$: 'GroupProfile',
            group: groupIdHash
        });
        const newModel = new GroupModel(groupIdHash, profileIdHash);
        await newModel.loadLatestVersion();
        return newModel;
    }

    /**
     * Construct from internal group name.
     *
     * Internal group name is the name parameter of the Group object.
     *
     * @param groupName
     */
    public static async constructFromLatestProfileVersionByGroupName(groupName: string) {
        const groupIdHash = await calculateIdHashOfObj({
            $type$: 'Group',
            name: groupName,
            person: []
        });
        const profileIdHash = await calculateIdHashOfObj({
            $type$: 'GroupProfile',
            group: groupIdHash
        });

        const loadedModel = new GroupModel(groupIdHash, profileIdHash);
        await loadedModel.loadLatestVersion();
        return loadedModel;
    }

    /**
     * Create a group and profile if they do not exist.
     *
     * If it already exists, it will simply return the existing group.
     *
     * @param groupName - Name if not given the internal name will be random, and the profile name will be 'unnamed group'
     * @returns The latest version of the group or an empty group.
     */
    public static async constructWithNewGroup(groupName?: string): Promise<GroupModel> {
        // Create a new group object if it does not yet exist. If it exists, skip.
        const newGroup: Group = {
            $type$: 'Group',
            name: groupName || (await createRandomString(32)),
            person: []
        };

        let groupResult;
        try {
            const groupIdHash = await calculateIdHashOfObj(newGroup);
            groupResult = await getObjectByIdHash(groupIdHash);
        } catch (_) {
            groupResult = await storeVersionedObject(newGroup);
        }

        // Create a new profile
        const newProfile: GroupProfile = {
            $type$: 'GroupProfile',
            group: groupResult.idHash,
            name: groupName || 'unnamed group',
            picture: DUMMY_BLOB_HASH
        };

        let profileResult;
        try {
            profileResult = await getObjectByIdObj(newProfile);
        } catch (_) {
            profileResult = await storeVersionedObject(newProfile);
        }

        const newModel = new GroupModel(groupResult.idHash, profileResult.idHash);
        await newModel.loadLatestVersion();
        return newModel;
    }

    // ######## getter ########

    /**
     * Returns the profile version that was loaded.
     */
    get loadedVersion(): SHA256Hash<GroupProfile> | undefined {
        this.state.assertCurrentState('Initialised');

        return this.pLoadedVersion;
    }

    /**
     * Returns the name of the loaded Group object.
     *
     * @throws if nothing was loaded
     */
    get internalGroupName(): string {
        this.state.assertCurrentState('Initialised');

        if (this.group === undefined) {
            throw new Error('GroupModel has no data (internalGroupName)');
        }
        return this.group.name;
    }

    // ######## Save & Load ########

    /**
     * Returns whether this model has data loaded.
     *
     * If this returns false, then the 'internalGroupName' property will throw and group members list and name and
     * picture will be empty / undefined.
     */
    public hasData(): boolean {
        this.state.assertCurrentState('Initialised');

        return this.profile !== undefined;
    }

    /**
     * Load a specific profile version.
     *
     * @param version
     */
    public async loadVersion(version: SHA256Hash<GroupProfile>): Promise<void> {
        this.state.assertCurrentState('Initialised');

        const profile = await getObject(version);
        const group = await getObjectByIdHash(profile.group);

        const profileIdHash = await calculateIdHashOfObj(profile);
        if (profileIdHash !== this.profileIdHash) {
            throw new Error('Specified profile version is not a version of the managed profile');
        }

        await this.updateModelDataFromGroupAndProfile(group.obj, profile, version);
    }

    /**
     * Load the latest profile version.
     */
    public async loadLatestVersion(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        const groupResult = await getObjectByIdHash(this.groupIdHash);
        const profileResult = await getObjectByIdHash(this.profileIdHash);

        await this.updateModelDataFromGroupAndProfile(
            groupResult.obj,
            profileResult.obj,
            profileResult.hash
        );
    }

    /**
     * Save the profile to disk and load the latest version.
     *
     * Why is there no pure save() function? The cause are CRDTs. The object that is eventually
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
        this.state.assertCurrentState('Initialised');

        if (this.group === undefined || this.profile === undefined) {
            throw new Error('No profile data that could be saved');
        }

        // Write image blob
        let blobHash = DUMMY_BLOB_HASH;
        if (this.picture) {
            const stream = createFileWriteStream();
            stream.write(this.picture);
            blobHash = (await stream.end()).hash;
        }

        // Write the new profile version
        const profileResult = await storeVersionedObject({
            $type$: 'GroupProfile',
            $versionHash$: this.profile.$versionHash$,
            group: this.groupIdHash,
            name: this.name,
            picture: blobHash
        });

        const groupResult = await storeVersionedObject({
            $type$: 'Group',
            $versionHash$: (this.group as any).$versionHash$,
            name: this.internalGroupName,
            person: this.persons
        });

        // ensure new list does not have duplicates
        this.persons = this.persons.filter((personId, i) => this.persons.indexOf(personId) === i);
        // combine old and new list to loop everyone and determine changes
        const all = this.persons.concat(this.group.person.filter(id => !this.persons.includes(id)));

        let added: SHA256IdHash<Person>[] | undefined = undefined;
        let removed: SHA256IdHash<Person>[] | undefined = undefined;
        for (const personId of all) {
            if (!this.persons.includes(personId) && this.group.person.includes(personId)) {
                if (!removed) {
                    removed = [];
                }
                removed.push(personId);
            } else if (this.persons.includes(personId) && !this.group.person.includes(personId)) {
                if (!added) {
                    added = [];
                }
                added.push(personId);
            }
        }

        await this.updateModelDataFromGroupAndProfile(
            groupResult.obj,
            profileResult.obj,
            profileResult.hash
        );

        this.onUpdated.emit(added, removed);
    }

    // ######## private stuff ########

    /**
     * Updates the members of the model based on a loaded profile and the version hash.
     *
     * @param group
     * @param profile
     * @param version
     * @private
     */
    private async updateModelDataFromGroupAndProfile(
        group: Group,
        profile: GroupProfile,
        version: SHA256Hash<GroupProfile>
    ): Promise<void> {
        this.name = profile.name;
        this.picture =
            profile.picture === DUMMY_BLOB_HASH
                ? undefined
                : await readBlobAsArrayBuffer(profile.picture);
        // this needs to be a copy, to keep original list in group
        this.persons = [...group.person];
        this.profile = profile;
        this.group = group;
        this.pLoadedVersion = version;
    }
}
