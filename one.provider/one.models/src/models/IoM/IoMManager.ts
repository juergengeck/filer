import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {createDefaultKeys, hasDefaultKeys} from '@refinio/one.core/lib/keychain/keychain.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import {getObjectByIdHash} from '@refinio/one.core/lib/storage-versioned-objects.js';

import {objectEvents} from '../../misc/ObjectEventDispatcher.js';
import type {Profile} from '../../recipes/Leute/Profile.js';
import ProfileModel from '../Leute/ProfileModel.js';
import IoMRequestManager from './IoMRequestManager.js';
import type {IoMRequest} from '../../recipes/IoM/IoMRequest.js';
import GroupModel from '../Leute/GroupModel.js';
import type LeuteModel from '../Leute/LeuteModel.js';
import type SomeoneModel from '../Leute/SomeoneModel.js';
import type {OneInstanceEndpoint} from '../../recipes/Leute/CommunicationEndpoints.js';
import {createLocalInstanceIfNoneExists} from '../../misc/instance.js';

import '../../recipes/SignatureRecipes.js';

const MessageBus = createMessageBus('IoMManager');

/**
 * This class sets up the Internet Of Me (IoM), after both parties approved the IoM.
 *
 * The initiator of the IoMRequest will become the main identity for both participants of the IoM.
 *
 * High level stuff is:
 * - Setting up 'leute' and 'identities' correctly if an IoM request was approved by both parties
 * - Managing the IoM group that can be used to share data to all IoM instances
 *
 * Setting up 'leute' and 'identities' correctly involves:
 * - Generate public/secret key pairs for the remote person
 * - Generate an instance with complete keys (-> local instance object)
 * - Create a OneCommunicationEndpoint with the remote person, the new keys and local instance
 * - Move the remote person to my own "Someone-object"
 * - If the IoM was initiated by the remote person: Switch my main id to the remote person id
 *
 * Everything related to negotiating an IoM is done by the IoMRequestManager that can be accessed by the public property
 * 'requestManager'. There you can create new IoM requests, affirm existing requests and list all pending IoMRequests.
 */
export default class IoMManager {
    public static readonly IoMGroupName = 'IoM';
    public readonly requestManager: IoMRequestManager;

    private readonly leuteModel: LeuteModel;
    private readonly commServerUrl: string;
    // private disconnectProfileListener: (() => void) | null = null;

    /**
     * Constructor
     *
     * @param leuteModel - The leute model used in order to set up the IoM after a successful IoM request
     * @param commServerUrl - The comm server url used to create the new OneInstanceEndpoint representing the new IoM
     *                        identity.
     */
    constructor(leuteModel: LeuteModel, commServerUrl: string) {
        this.leuteModel = leuteModel;
        this.requestManager = new IoMRequestManager(this.leuteModel.trust);
        this.requestManager.onRequestComplete(this.setupIomFromCompletedRequest.bind(this));
        this.commServerUrl = commServerUrl;

        objectEvents.onUnversionedObject(
            async result => {
                const cert = await getObject(result.obj.data);

                if (cert.$type$ !== 'AffirmationCertificate') {
                    return;
                }

                const profile = await getObject(cert.data);

                if (profile.$type$ !== 'Profile') {
                    return;
                }

                await this.resignProfileIfOk(profile, cert.data as SHA256Hash<Profile>);
            },
            'IoMManager: New certificate - resignProfileIfOk',
            'Signature'
        );

        objectEvents.onNewVersion(
            async result => {
                await this.resignProfileIfOk(result.obj, result.hash);
            },
            'IoMManager: New profile version - resignProfileIfOk',
            'Profile'
        );
    }

    /**
     * Initialize the IomManager
     */
    async init() {
        await this.initIomGroup();
        await this.requestManager.init();
    }

    /**
     * Shutdown the IoMManager
     */
    async shutdown() {
        await this.requestManager.shutdown();
    }

    /**
     * Get the IoM group.
     */
    async iomGroup(): Promise<GroupModel> {
        return GroupModel.constructFromLatestProfileVersionByGroupName(IoMManager.IoMGroupName);
    }

    // ######## IoM Setup after successful IoMRequest ########

    /**
     * This function will setup everything so that a complete IoM will form.
     *
     * It is usually called when a successful IoMRequest was established.
     *
     * @param _requestHash - The hash of the IoMRequest that was completed.
     * @param request - The IoMRequest that was completed.
     */
    private async setupIomFromCompletedRequest(
        _requestHash: SHA256Hash<IoMRequest>,
        request: IoMRequest
    ): Promise<void> {
        MessageBus.send('log', 'setupIoM', request);

        // Extract the other identity and create a complete set of person and instance keys
        const {me, other} = await this.whoIsMeAndOther(request.mainId, request.alternateId);
        MessageBus.send('log', `setupIom - me ${me}, other ${other}`);

        // If light mode, then only generate keys and instance if the other identity becomes the
        // main id
        if (request.mode === 'full' || other === request.mainId) {
            const newPersonKeys = await createDefaultKeys(other);
            const newLocalInstance = await createLocalInstanceIfNoneExists(other);

            // Incorporate the other identity in our own someone object and create endpoints with the new instance and keys
            await this.moveIdentityToMySomeone(other);
            const profileVersion = await this.createProfileWithKeys(other, {
                $type$: 'OneInstanceEndpoint',
                personId: other,
                url: this.commServerUrl,
                instanceId: newLocalInstance.instanceId,
                instanceKeys: newLocalInstance.instanceKeys,
                personKeys: newPersonKeys
            });

            const affirmationCert = await this.leuteModel.trust.certify(
                'AffirmationCertificate',
                {data: profileVersion},
                me
            );
            await this.leuteModel.shareObjectWithEveryone(affirmationCert.signature.hash);
        } else {
            await this.moveIdentityToMySomeone(other);
        }

        // Update the IoM group with the other identity
        await this.addPersonToIomGroup(other);

        // Switch my main identity if the other side was the initiator
        if (other === request.mainId) {
            await this.leuteModel.changeMyMainIdentity(other);
        }
    }

    // ######## IoM Group functions ########

    /**
     * This initializes the IoM group where all IoM identities will be registered.
     */
    private async initIomGroup(): Promise<void> {
        const meSomeone = await this.leuteModel.me();
        const me = await meSomeone.mainIdentity();

        const group = await GroupModel.constructWithNewGroup(IoMManager.IoMGroupName);
        if (!group.persons.includes(me)) {
            group.persons.push(me);
            await group.saveAndLoad();
        }
    }

    /**
     * Adds a person to the IoM group.
     *
     * @param personId
     */
    private async addPersonToIomGroup(personId: SHA256IdHash<Person>): Promise<void> {
        MessageBus.send('log', `addPersonToIomGroup ${personId}`);
        const group = await this.iomGroup();
        group.persons.push(personId);
        await group.saveAndLoad();
        this.leuteModel.onMeIdentitiesChange.emit();
        MessageBus.send('log', `addPersonToIomGroup ${personId} - done`);
    }

    // ######## Leute related helpers ########

    /**
     * Determine which of the two identities is me or someone else.
     *
     * @param person1
     * @param person2
     */
    private async whoIsMeAndOther(
        person1: SHA256IdHash<Person>,
        person2: SHA256IdHash<Person>
    ): Promise<{
        me: SHA256IdHash<Person>;
        other: SHA256IdHash<Person>;
    }> {
        const mySomeone = await this.leuteModel.me();
        const iAmPerson1 = mySomeone.identities().includes(person1);
        const iAmPerson2 = mySomeone.identities().includes(person2);
        if (!iAmPerson1 && !iAmPerson2) {
            throw new Error('I am not part of the IoMRequest');
        }
        if (iAmPerson1 && iAmPerson2) {
            throw new Error('I am both persons - already in the IoM!');
        }

        //const myId = iAmInitiator ? initiator : participant;
        return {
            me: iAmPerson1 ? person1 : person2,
            other: iAmPerson1 ? person2 : person1
        };
    }

    /**
     * Get the matching someone object
     *
     * @param identity
     */
    private async getSomeoneOrThrow(identity: SHA256IdHash<Person>): Promise<SomeoneModel> {
        const someone = await this.leuteModel.getSomeone(identity);

        if (someone === undefined) {
            throw new Error("We don't have a someone object for the other identity");
        }

        return someone;
    }

    /**
     * Move an identity from one someone object to my own someone object.
     *
     * This will also transfer all profiles from the old one to the new one.
     *
     * Note: I have no idea what happens when we removed the main identity and alternate identities still
     * exist on the someone object. This would leave the someone object with a main profile of the old identity I guess
     *
     * @param identity
     */
    private async moveIdentityToMySomeone(identity: SHA256IdHash<Person>): Promise<void> {
        MessageBus.send('log', `moveIdentityToMySomeone ${identity}`);
        const from = await this.getSomeoneOrThrow(identity);
        const to = await this.leuteModel.me();

        // Add identity to new someone
        await to.addIdentity(identity);

        // Transfer profiles from old to new someone
        const profiles = await from.profiles(identity);
        for (const profile of profiles) {
            await to.addProfile(profile.idHash);
        }

        // Remove identity from the old someone
        await from.removeIdentity(identity);
        if (from.identities().length === 0) {
            await this.leuteModel.removeSomeoneElse(from.idHash);
        }

        MessageBus.send('log', `moveIdentityToMySomeone ${identity} - done`);
    }

    /**
     * Add an endpoint to the default profile of this identity.
     *
     * @param identity
     * @param endpoint
     */
    private async createProfileWithKeys(
        identity: SHA256IdHash<Person>,
        endpoint: OneInstanceEndpoint
    ): Promise<SHA256Hash<Profile>> {
        MessageBus.send('log', `addKeysToDefaultProfile ${identity}`, endpoint);

        const someone = await this.getSomeoneOrThrow(identity);
        const profiles = await someone.profiles(identity);
        const keys = await getObject(endpoint.personKeys);
        const profile = await ProfileModel.constructWithNewProfile(
            identity,
            identity,
            'default',
            [endpoint],
            [
                {
                    $type$: 'SignKey',
                    key: keys.publicSignKey
                }
            ]
        );

        if (profile.loadedVersion === undefined) {
            throw new Error(
                'IoMManager: Error writing default profile (loadedVersion is undefined)'
            );
        }

        MessageBus.send('log', `addKeysToDefaultProfile ${identity} - done`);
        return profile.loadedVersion;
    }

    async resignProfileIfOk(profile: Profile, profileHash: SHA256Hash<Profile>) {
        if (this.leuteModel.state.currentState !== 'Initialised') {
            return;
        }

        // We only sign versions of the default profile owned by the target person.
        if (profile.personId !== profile.owner) {
            return;
        }

        if (!(await hasDefaultKeys(profile.personId))) {
            return;
        }

        const affirmers = await this.leuteModel.trust.affirmedBy(profileHash);
        const me = await this.leuteModel.me();

        // Check that I myself signed this profile but from a different identity that
        // the one that the profile is about
        {
            let isAffirmedByIdentityOtherThanProfile = false;
            const otherIdentites = new Set(me.identities());
            otherIdentites.delete(profile.personId);

            for (const affirmer of affirmers) {
                if (otherIdentites.has(affirmer)) {
                    isAffirmedByIdentityOtherThanProfile = true;
                }
            }

            if (!isAffirmedByIdentityOtherThanProfile) {
                return;
            }
        }

        const affirmationCert = await this.leuteModel.trust.affirm(profileHash, profile.personId);
        await this.leuteModel.shareObjectWithIoM(affirmationCert.hash);

        await this.leuteModel.trust.certify(
            'TrustKeysCertificate',
            {profile: profileHash},
            profile.personId
        );
    }
}
