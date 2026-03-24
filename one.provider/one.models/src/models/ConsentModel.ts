import {Model} from './Model.js';
import type ChannelManager from './ChannelManager.js';
import type {Consent_1_1_0} from '../recipes/ConsentRecipes/ConsentRecipes_1_1_0.js';
import {StateMachine} from '../misc/StateMachine.js';
import {
    getObjectWithType,
    storeUnversionedObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {sign} from '../misc/Signature.js';
import {storeFileWithBlobDescriptor} from '../misc/storeFileWithBlobDescriptor.js';

export type Consent = Consent_1_1_0;
export const ConsentType = 'Consent_1_1_0';

type FileStatusTuple = [File, Consent_1_1_0['status']];
type TextStatusTuple = [string, Consent_1_1_0['status']];

/**
 * This model deals with the user consent.
 *
 * The consent can be given and revoked and the object needs to be signed by the user.
 *
 * When the consent is given data is shared with a predefined entity.
 * When the consent is revoked this sharing needs to stop.
 *
 * The application needs to take care of the previous tasks.
 * Therefore it can:
 *  * Check the public `consentState` to see the current consent state
 *  * Listen and filter on ConsentModel.consentState
 *      .onEnterState(state => {if (state == 'Revoked'){ do ...}})
 *    to stop sharing if it is received.
 *
 */
export default class ConsentModel extends Model {
    public static readonly channelId = 'consent';
    public consentState: StateMachine<
        'Uninitialised' | 'Given' | 'Revoked',
        'giveConsent' | 'revokeConsent' | 'shutdown'
    >;

    // Contains the date of the first consent for the application
    public firstConsentDate: Date | undefined;

    private consentsToWrite: (FileStatusTuple | TextStatusTuple)[] = [];
    private channelManager: ChannelManager | undefined;

    constructor() {
        super();
        this.consentState = new StateMachine<
            'Uninitialised' | 'Given' | 'Revoked',
            'giveConsent' | 'revokeConsent' | 'shutdown'
        >();

        this.consentState.addState('Uninitialised');
        this.consentState.addState('Given');
        this.consentState.addState('Revoked');
        this.consentState.addEvent('giveConsent');
        this.consentState.addEvent('revokeConsent');
        this.consentState.addEvent('shutdown');
        this.consentState.addTransition('giveConsent', 'Uninitialised', 'Given');
        this.consentState.addTransition('revokeConsent', 'Given', 'Revoked');
        // not needed for ARTEMIS but generally makes sense
        this.consentState.addTransition('revokeConsent', 'Uninitialised', 'Revoked');
        this.consentState.addTransition('shutdown', 'Given', 'Uninitialised');
        this.consentState.addTransition('shutdown', 'Revoked', 'Uninitialised');

        this.consentState.setInitialState('Uninitialised');
    }

    /**
     * The init function is only called after ONE is initialized
     *
     * It updates the state from storage if no consent changes where queued.
     * Else it writes the queue to storage
     * @param channelManager
     */
    public async init(channelManager: ChannelManager) {
        this.state.assertCurrentState('Uninitialised');
        this.channelManager = channelManager;

        await this.channelManager.createChannel(ConsentModel.channelId);

        // Update state from storage if no queued consents are present
        if (this.consentsToWrite.length === 0) {
            const latestChannelEntry = await this.channelManager.getObjects({
                channelId: ConsentModel.channelId,
                count: 1
            });

            // The latest consent can be empty e.g. in a replicant
            if (latestChannelEntry.length > 0) {
                const latestSignature = await getObjectWithType(
                    latestChannelEntry[0].dataHash,
                    'Signature'
                );
                const latestConsent = await getObjectWithType(
                    latestSignature.data,
                    'Consent_1_1_0'
                );

                this.setState(latestConsent.status);
            }
        } else {
            // Write all queued consents
            for (const fileOrTextStatusTuple of this.consentsToWrite) {
                const [fileOrText, status] = fileOrTextStatusTuple;
                if (typeof fileOrText === 'string') {
                    await this.writeConsentText(fileOrText, status);
                } else {
                    await this.writeConsent(fileOrText, status);
                }
            }

            // Cleanup the queue
            this.consentsToWrite = [];
        }

        // Get the first consent after queue has potentially been written
        const allChannelEntrys = await this.channelManager.getObjects({
            channelId: ConsentModel.channelId
        });

        // The channel can be empty
        if (allChannelEntrys.length > 0) {
            const firstChannelEntry = allChannelEntrys[0];
            const firstSignature = await getObjectWithType(firstChannelEntry.dataHash, 'Signature');
            const firstConsent = await getObjectWithType(firstSignature.data, 'Consent_1_1_0');
            this.firstConsentDate = new Date(firstConsent.isoStringDate);
        }

        this.state.triggerEvent('init');
    }

    public async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        // after init the queue and all new consents are written to the storage so we don't need
        // to check here for unwritten consents

        this.state.triggerEvent('shutdown');
        this.consentState.triggerEvent('shutdown');
    }

    public async setConsent(file: File, status: Consent_1_1_0['status']) {
        if (this.state.currentState === 'Uninitialised') {
            this.consentsToWrite.push([file, status]);
        } else {
            await this.writeConsent(file, status);
        }
        this.setState(status);
    }

    public async setConsentText(text: string, status: Consent_1_1_0['status']) {
        if (this.state.currentState === 'Uninitialised') {
            this.consentsToWrite.push([text, status]);
        } else {
            await this.writeConsentText(text, status);
        }
        this.setState(status);
    }

    /**
     * Do the state transition
     * @param status
     * @private
     */
    private setState(status: Consent_1_1_0['status']) {
        if (status === 'given') {
            this.consentState.triggerEvent('giveConsent');
        }
        if (status === 'revoked') {
            this.consentState.triggerEvent('revokeConsent');
        }
    }

    private async writeConsentText(text: string, status: Consent_1_1_0['status']) {
        if (this.channelManager === undefined) {
            throw new Error('init() has not been called yet');
        }

        const consent: Consent_1_1_0 = {
            $type$: 'Consent_1_1_0',
            text: text,
            isoStringDate: new Date().toISOString(),
            status
        };

        // signing
        const consentResult = await storeUnversionedObject(consent);
        const signedConsent = await sign(consentResult.hash);

        await this.channelManager.postToChannel(
            ConsentModel.channelId,
            signedConsent.obj,
            undefined
        );
    }

    private async writeConsent(file: File, status: Consent_1_1_0['status']) {
        if (this.channelManager === undefined) {
            throw new Error('init() has not been called yet');
        }

        const blobDescriptor = await storeFileWithBlobDescriptor(file);

        const consent: Consent_1_1_0 = {
            $type$: 'Consent_1_1_0',
            fileReference: blobDescriptor.hash,
            isoStringDate: new Date().toISOString(),
            status
        };

        // signing
        const consentResult = await storeUnversionedObject(consent);
        const signedConsent = await sign(consentResult.hash);

        await this.channelManager.postToChannel(
            ConsentModel.channelId,
            signedConsent.obj,
            undefined
        );
    }
}
