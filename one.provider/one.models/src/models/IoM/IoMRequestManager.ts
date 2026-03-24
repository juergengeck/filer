import {createAccess} from '@refinio/one.core/lib/access.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {
    getObject,
    storeUnversionedObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {
    getObjectByIdObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {objectEvents} from '../../misc/ObjectEventDispatcher.js';
import {OEvent} from '../../misc/OEvent.js';
import type {IoMRequest} from '../../recipes/IoM/IoMRequest.js';
import type {IoMRequestsRegistry} from '../../recipes/IoM/IoMRequestsRegistry.js';
import type {Signature} from '../../recipes/SignatureRecipes.js';
import type TrustedKeysManager from '../Leute/TrustedKeysManager.js';

const messageBus = createMessageBus('IoMRequestManager');

/**
 * This class manages IoM requests.
 *
 * The IoM Request is exchanged using IoMRequest objects that are locally registered at the
 * IoMRequestRegistry.
 *
 * The class allows you to create an IoMRequest that is distributed to the other participants. They
 * are then notified through the onNewRequest event and can affirm the request.
 * Affirmation works by creating an affirmation certificate that is then distributed back to all
 * other participants.
 *
 * TODO:
 * - At the moment we cannot decline the request, only ignore it.
 * - At the moment you should only create 1:1 requests, because if you have more participants
 *   the synchronization between all participants is complicated. Therefore we might remove
 *   support for multiple participants in the future when adding the ability to decline requests.
 */
export default class IoMRequestManager {
    public onError = new OEvent<(message: any) => void>();
    public onNewRequest = new OEvent<
        (requestHash: SHA256Hash<IoMRequest>, request: IoMRequest) => void
    >();
    public onRequestUpdate = new OEvent<
        (requestHash: SHA256Hash<IoMRequest>, request: IoMRequest) => void
    >();
    public onRequestComplete = new OEvent<
        (requestHash: SHA256Hash<IoMRequest>, request: IoMRequest) => void
    >();
    private disconnectListener: (() => void) | null = null;
    private requestsRegistry: IoMRequestsRegistry = {
        $type$: 'IoMRequestsRegistry',
        appId: 'one.iom',
        requests: new Set()
    };
    private isInitialized = false;
    private trustedKeysManager: TrustedKeysManager;

    constructor(trustedKeysManager: TrustedKeysManager) {
        this.trustedKeysManager = trustedKeysManager;
    }

    // ######## model state management ########

    /**
     * Init the request manager.
     */
    public async init(): Promise<void> {
        messageBus.send('debug', 'init');
        const d1 = objectEvents.onUnversionedObject(
            this.processNewIomRequest.bind(this),
            'IoMRequestManager: processNewIomRequest',
            'IoMRequest'
        );
        const d2 = objectEvents.onUnversionedObject(
            this.processNewIoMRequestCertificate.bind(this),
            'IoMRequestManager: processNewIomRequestCertificate',
            'Signature'
        );
        this.disconnectListener = () => {
            d1();
            d2();
        };

        // initialize the registry
        await this.initRegistry();

        this.isInitialized = true;
    }

    /**
     * Shutdown the request manager.
     */
    public async shutdown(): Promise<void> {
        messageBus.send('debug', 'shutdown');
        this.isInitialized = false;
        if (this.disconnectListener) {
            this.disconnectListener();
        }
        await this.shutdownRegistry();
    }

    // ######## requests management ########

    /**
     * Creates a new IoM request.
     *
     * @param initiator - The person who initiated the request
     * @param mainId - The identity that becomes the main identity on both sides
     * @param alternateId - The identity that will become an alternate identity (not main)
     * @param mode - 'full' means that both identities will get private keys on both sides
     *               'light' means that only the main identity will get private keys on both sides
     */
    async createIoMRequest(
        initiator: SHA256IdHash<Person>,
        mainId: SHA256IdHash<Person>,
        alternateId: SHA256IdHash<Person>,
        mode: 'full' | 'light' = 'full'
    ) {
        messageBus.send('debug', `createIoMReuqest ${initiator} ${mainId} ${alternateId}`);
        const requestResult = await storeUnversionedObject({
            $type$: 'IoMRequest',
            timestamp: Date.now(),
            initiator,
            mainId,
            alternateId,
            mode
        });

        await this.affirmRequestObj(requestResult.hash, requestResult.obj);
    }

    /**
     * Affirm an IoMRequest - this means that you want to join the IoM.
     *
     * @param requestHash
     */
    async affirmRequest(requestHash: SHA256Hash<IoMRequest>) {
        messageBus.send('debug', `affirmRequest ${requestHash}`);
        await this.affirmRequestObj(requestHash, await getObject(requestHash));
    }

    /**
     * Obtain all requests.
     */
    async allRequests(): Promise<
        {active: boolean; requestHash: SHA256Hash<IoMRequest>; request: IoMRequest}[]
    > {
        const requests = [];

        for (const requestHash of this.requestsRegistry.requests) {
            const request = await getObject(requestHash);
            requests.push({
                active: await this.isRequestCompleted(requestHash, request),
                requestHash,
                request
            });
        }

        return requests;
    }

    // ######## Check completeness ########

    private async isRequestCompleted(
        requestHash: SHA256Hash<IoMRequest>,
        request: IoMRequest
    ): Promise<boolean> {
        messageBus.send('debug', `isRequestCompleted ${requestHash} ${JSON.stringify(request)}`);
        const affirmedByPersons = new Set(await this.trustedKeysManager.affirmedBy(requestHash));
        messageBus.send(
            'debug',
            `isRequestCompleted - ${requestHash} affirmed by ${JSON.stringify([
                ...affirmedByPersons
            ])}`
        );

        // Check that the sets are equal
        if (affirmedByPersons.size !== 2) {
            messageBus.send(
                'debug',
                `isRequestCompleted - ${requestHash} size mismatch ${affirmedByPersons.size} !== 2`
            );
            return false;
        }

        const participants = [request.mainId, request.alternateId];

        if (!participants.includes(request.initiator)) {
            messageBus.send(
                'debug',
                `isRequestCompleted - ${requestHash} initiator ${request.initiator} is not main or alternate id ${request.mainId} ${request.alternateId}`
            );
            return false;
        }

        // Now check all the elements
        for (const participant of participants) {
            if (!affirmedByPersons.has(participant)) {
                messageBus.send(
                    'debug',
                    `isRequestCompleted - content mismatch ${requestHash} ${participant}`
                );
                return false;
            }
        }

        messageBus.send('debug', `isRequestCompleted - success ${requestHash}`);
        return true;
    }

    private async emitIfRequestCompleted(
        requestHash: SHA256Hash<IoMRequest>,
        request: IoMRequest
    ): Promise<void> {
        if (await this.isRequestCompleted(requestHash, request)) {
            messageBus.send('log', `Request ${requestHash} was accepted by all participants.`);
            this.onRequestComplete.emit(requestHash, request);
        }
    }

    // ######## ObjectListener ########

    private async processNewIomRequest(result: UnversionedObjectResult<IoMRequest>) {
        messageBus.send('debug', `processNewIomRequest ${result.hash}`);
        this.requestsRegistry.requests.add(result.hash);
        await this.saveRegistry();
        this.onNewRequest.emit(result.hash, result.obj);
    }

    private async processNewIoMRequestCertificate(result: UnversionedObjectResult<Signature>) {
        // Step 1: Load the certificate object (might be something else)
        const certificate = await getObject(result.obj.data);
        if (certificate.$type$ !== 'AffirmationCertificate') {
            return;
        }

        messageBus.send('debug', `processNewIoMRequestCertificate ${result.hash}`);

        // Step 2: Load the request (might be something else)
        const request = await getObject(certificate.data);
        if (request.$type$ !== 'IoMRequest') {
            return;
        }

        // Step 3: Check if IoM request is fulfilled
        messageBus.send('debug', `processNewIoMRequestCertificate - isIomRequest ${result.hash}`);
        const requestHash = certificate.data as SHA256Hash<IoMRequest>;

        messageBus.send(
            'log',
            `Participant ${result.obj.issuer} affirmed IoM Request ${certificate.data}`
        );

        this.onRequestUpdate.emit(requestHash, request);
        await this.emitIfRequestCompleted(requestHash, request);
    }

    // ######## IoMRequestsRegistry ########

    private async initRegistry() {
        try {
            this.requestsRegistry = (
                await getObjectByIdObj({
                    $type$: 'IoMRequestsRegistry',
                    appId: 'one.iom'
                })
            ).obj;
        } catch (_) {
            // Ignore file not found error and just use the empty default IoMRequests. Persist
            // the empty registry.
            await this.saveRegistry();
        }
    }

    private async shutdownRegistry() {
        this.requestsRegistry = {
            $type$: 'IoMRequestsRegistry',
            appId: 'one.iom',
            requests: new Set()
        };
    }

    private async saveRegistry() {
        await storeVersionedObject(this.requestsRegistry);
    }

    // ######## Misc ########

    private assertInitialized() {
        if (!this.isInitialized) {
            throw new Error(
                'PersonNameCache: You cannot use any method of this class, because it is already shut down.'
            );
        }
    }

    private async affirmRequestObj(requestHash: SHA256Hash<IoMRequest>, request: IoMRequest) {
        messageBus.send('debug', `affirmRequestObj ${requestHash}`);

        // affirm the request
        const requestCertificateSignature = await this.trustedKeysManager.affirm(requestHash);

        messageBus.send(
            'debug',
            `affirmRequestObj - requestHash ${requestHash}, signatureHash ${requestCertificateSignature.hash}`
        );

        // Share it with all the participants
        await createAccess([
            {
                object: requestCertificateSignature.hash,
                person: [request.mainId, request.alternateId],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);
    }
}
