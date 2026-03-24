/**
 * Connection Handler for one.provider
 *
 * Handles connection establishment with remote ONE instances and contact management.
 */

import {getInstanceIdHash, getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type ConnectionsModel from '@refinio/one.models/lib/models/ConnectionsModel.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';

export class ConnectionHandler {
    private leuteModel: LeuteModel;
    private connectionsModel: ConnectionsModel;
    private inviteUrlPrefix: string;

    constructor(
        leuteModel: LeuteModel,
        connectionsModel: ConnectionsModel,
        inviteUrlPrefix: string = 'https://one.local/invite'
    ) {
        this.leuteModel = leuteModel;
        this.connectionsModel = connectionsModel;
        this.inviteUrlPrefix = inviteUrlPrefix;
    }

    /**
     * Get instance status
     */
    async getStatus(): Promise<{
        instanceId: string;
        ownerId: string;
        contacts: number;
    }> {
        const instanceId = getInstanceIdHash();
        const ownerId = getInstanceOwnerIdHash();
        const others = await this.leuteModel.others();

        return {
            instanceId: instanceId || 'unknown',
            ownerId: ownerId || 'unknown',
            contacts: others.length
        };
    }

    /**
     * Create an IOP (Instance-to-Instance Pairing) invite
     */
    async createInvite(): Promise<{
        success: boolean;
        inviteUrl?: string;
        error?: string;
    }> {
        try {
            console.error('[ConnectionHandler] Creating IOP invite...');

            // Create pairing invitation via ConnectionsModel
            const pairingManager = this.connectionsModel.pairing;
            const invitation = await pairingManager.createInvitation();

            console.error('[ConnectionHandler] Invitation created:', {
                url: invitation.url,
                publicKey: invitation.publicKey?.substring(0, 16) + '...',
                hasToken: !!invitation.token
            });

            // Encode invitation as URL fragment (same format as refinio.api)
            const inviteData = {
                url: invitation.url,
                publicKey: invitation.publicKey,
                token: invitation.token
            };

            const encoded = encodeURIComponent(JSON.stringify(inviteData));
            const inviteUrl = `${this.inviteUrlPrefix}#${encoded}`;

            console.error('[ConnectionHandler] Invite URL created:', inviteUrl);

            return {
                success: true,
                inviteUrl
            };
        } catch (error: any) {
            console.error('[ConnectionHandler] Failed to create invite:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Connect using an IOP invite
     */
    async connectWithInvite(inviteData: {
        url: string;
        publicKey: string;
        token: string;
    }): Promise<{
        success: boolean;
        connectionInfo?: {
            personId: string;
            remoteInstanceId: string;
            contactCreated: boolean;
        };
        error?: string;
    }> {
        console.error('[ConnectionHandler] Connecting with IOP invite...');

        try {
            const invitation = {
                url: inviteData.url,
                publicKey: inviteData.publicKey as HexString,
                token: inviteData.token
            };

            // Register callback FIRST, before calling connectUsingInvitation
            const pairingPromise = new Promise<{
                remotePersonId: SHA256IdHash<any>;
                remoteInstanceId: SHA256IdHash<any>;
            }>((resolve, reject) => {
                let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
                let disconnectCallback: (() => void) | null = null;

                const cleanup = () => {
                    if (timeoutHandle) {
                        clearTimeout(timeoutHandle);
                        timeoutHandle = null;
                    }
                    if (disconnectCallback) {
                        disconnectCallback();
                        disconnectCallback = null;
                    }
                };

                // Register one-time callback for this pairing
                const callback = async (
                    initiatedLocally: boolean,
                    localPersonId: SHA256IdHash<any>,
                    localInstanceId: SHA256IdHash<any>,
                    remotePersonId: SHA256IdHash<any>,
                    remoteInstanceId: SHA256IdHash<any>,
                    token: string
                ) => {
                    console.error('[ConnectionHandler] Pairing success!');
                    console.error(`  Remote person: ${remotePersonId}`);
                    console.error(`  Remote instance: ${remoteInstanceId}`);

                    cleanup();
                    resolve({remotePersonId, remoteInstanceId});
                };

                disconnectCallback = this.connectionsModel.pairing.onPairingSuccess(callback);

                // Set 60 second timeout
                timeoutHandle = setTimeout(() => {
                    cleanup();
                    reject(new Error('Pairing timeout after 60 seconds'));
                }, 60000);

                // Initiate connection
                this.connectionsModel.pairing.connectUsingInvitation(invitation).catch((err) => {
                    cleanup();
                    reject(err);
                });
            });

            // Wait for pairing to complete
            const {remotePersonId, remoteInstanceId} = await pairingPromise;

            // Note: Contact is automatically created during pairing
            // The pairing process should have created the contact
            console.error('[ConnectionHandler] Connection established successfully');

            return {
                success: true,
                connectionInfo: {
                    personId: remotePersonId,
                    remoteInstanceId: remoteInstanceId,
                    contactCreated: true  // Pairing automatically creates contact
                }
            };
        } catch (error: any) {
            console.error('[ConnectionHandler] Connection failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * List active connections
     */
    async listConnections(): Promise<{
        connections: Array<{
            instanceId: string;
            personId?: string;
            state: string;
        }>;
    }> {
        // Get connection information from ConnectionsModel
        const connectionInfos = this.connectionsModel.connectionsInfo();
        const connections: Array<{instanceId: string; personId?: string; state: string}> = [];

        for (const info of connectionInfos) {
            connections.push({
                instanceId: info.remoteInstanceId || 'unknown',
                personId: info.remotePersonId || undefined,
                state: 'open'
            });
        }

        return {connections};
    }
}
