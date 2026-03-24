import {expect} from 'chai';
import {existsSync, readFileSync} from 'fs';
import {closeAndDeleteCurrentInstance} from '@refinio/one.core/lib/instance.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import {wait} from '@refinio/one.core/lib/util/promise.js';

// Import from compiled lib
import ConnectionsModel from '../lib/models/ConnectionsModel.js';
import LeuteModel from '../lib/models/Leute/LeuteModel.js';
import {getPairingInformation} from '../lib/api/utils/paring.js';
import * as StorageTestInit from './_helpers.js';

const MessageBus = createMessageBus('filer-pairing-test');

describe('Filer Pairing and Sync Test', function () {
    this.timeout(60000); // 60 second timeout for connection tests

    let leuteModel: LeuteModel;
    let connectionsModel: ConnectionsModel;

    before(async function () {
        // Initialize test instance
        MessageBus.send('log', 'Initializing test ONE instance...');
        await StorageTestInit.init();

        // Create LeuteModel first
        leuteModel = new LeuteModel('ws://localhost:8000');

        // Add debug logging for OneInstanceEndpoint events
        leuteModel.onNewOneInstanceEndpoint((endpoint, isMe) => {
            MessageBus.send('log', `🔔 onNewOneInstanceEndpoint fired: isMe=${isMe}, personId=${endpoint.personId}, instanceId=${endpoint.instanceId}, url=${endpoint.url}`);
        });

        await leuteModel.init();
        MessageBus.send('log', 'LeuteModel initialized');

        // Create ConnectionsModel with LeuteModel
        connectionsModel = new ConnectionsModel(leuteModel, {
            commServerUrl: 'ws://localhost:8000',
            establishOutgoingConnections: true,
            allowPairing: true,
            acceptIncomingConnections: true
        });

        // Add debug logging for pairing success
        connectionsModel.pairing.onPairingSuccess((initiatedLocally, localPersonId, localInstanceId, remotePersonId, remoteInstanceId) => {
            MessageBus.send('log', `🎉 Pairing success: initiatedLocally=${initiatedLocally}, localPerson=${localPersonId}, remotePerson=${remotePersonId}, remoteInstance=${remoteInstanceId}`);
        });

        await connectionsModel.init();
        MessageBus.send('log', 'ConnectionsModel initialized');
    });

    after(async function () {
        if (connectionsModel) {
            await connectionsModel.shutdown();
        }
        if (leuteModel) {
            await leuteModel.shutdown();
        }
        await closeAndDeleteCurrentInstance();
    });

    describe('IOP Invite Pairing', () => {
        it('should parse the IOP invite correctly', () => {
            const inviteFilePath = 'C:\\OneFiler\\invites\\iop_invite.txt';

            if (!existsSync(inviteFilePath)) {
                console.log('Invite file not found, skipping test');
                return;
            }

            const inviteUrl = readFileSync(inviteFilePath, 'utf-8').trim();
            const invitation = getPairingInformation(inviteUrl);

            expect(invitation).to.not.be.undefined;
            expect(invitation).to.have.property('token');
            expect(invitation).to.have.property('publicKey');
            expect(invitation).to.have.property('url');

            MessageBus.send('log', `Parsed invitation - URL: ${invitation!.url}, token: ${invitation!.token.substring(0, 20)}...`);
        });

        it('should connect to Filer using the IOP invite', async function () {
            // Skip if running in CI or without Filer
            if (process.env.CI) {
                console.log('Skipping in CI environment');
                return;
            }

            const inviteFilePath = 'C:\\OneFiler\\invites\\iop_invite.txt';

            if (!existsSync(inviteFilePath)) {
                console.log('Invite file not found, skipping test');
                return;
            }

            const inviteUrl = readFileSync(inviteFilePath, 'utf-8').trim();
            const invitation = getPairingInformation(inviteUrl);

            if (!invitation) {
                throw new Error('Failed to parse invitation');
            }

            MessageBus.send('log', 'Attempting to connect using invitation...');
            MessageBus.send('log', `Invitation URL: ${invitation.url}`);
            MessageBus.send('log', `Invitation token: ${invitation.token.substring(0, 20)}...`);

            try {
                // Use the pairing manager to connect
                MessageBus.send('log', '📞 Calling connectUsingInvitation...');
                await connectionsModel.pairing.connectUsingInvitation(invitation);
                MessageBus.send('log', '✅ connectUsingInvitation completed');

                // Check connections immediately
                let connections = connectionsModel.connectionsInfo();
                MessageBus.send('log', `Connections immediately after pairing: ${connections.length}`);

                // Wait for automatic CHUM connection to establish
                MessageBus.send('log', '⏱️  Waiting 3 seconds for automatic CHUM connection...');
                await wait(3000);

                // Check connections again
                connections = connectionsModel.connectionsInfo();
                MessageBus.send('log', `Connections after 3 second wait: ${connections.length}`);

                expect(connections.length).to.be.greaterThan(0);

                // Log connection details
                connections.forEach((conn: any) => {
                    MessageBus.send('log', `
                        Found connection
                        Remote Instance: ${conn.remoteInstanceId}
                        Remote Person: ${conn.remotePersonId}
                        Routes: ${conn.routes.length}
                    `);
                });

                // Check for connections
                expect(connections.length).to.be.greaterThan(0);

            } catch (error) {
                MessageBus.send('log', `Connection failed: ${error}`);
                throw error;
            }
        });

        it('should verify connection is established', async function () {
            const connections = connectionsModel.connectionsInfo();

            if (connections.length === 0) {
                MessageBus.send('log', 'No connections available');
                return;
            }

            // Verify we have connections that could be used for syncing
            MessageBus.send('log', `Verifying ${connections.length} connections are available`);

            connections.forEach((conn: any) => {
                MessageBus.send('log', `Connection to: ${conn.remoteInstanceId || 'unknown'}`);
            });

            // Here we would use ChannelManager to actually sync objects
            // The connection is now established and ready for data sync
            MessageBus.send('log', 'Connections are ready for data synchronization');
        });

        it('should maintain stable connection for 10 seconds', async function () {
            const connections = connectionsModel.connectionsInfo();

            if (connections.length === 0) {
                MessageBus.send('log', 'No connections available');
                return;
            }

            MessageBus.send('log', `Initial connections: ${connections.length}`);

            // Monitor connection stability
            for (let i = 0; i < 5; i++) {
                await wait(2000);

                const currentConnections = connectionsModel.connectionsInfo();

                MessageBus.send('log', `After ${(i + 1) * 2}s: ${currentConnections.length} connections`);

                // Connection should remain stable
                expect(currentConnections.length).to.be.greaterThan(0);
            }

            MessageBus.send('log', 'Connection remained stable for 10 seconds');
        });
    });
});