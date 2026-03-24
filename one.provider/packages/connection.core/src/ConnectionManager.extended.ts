/**
 * ConnectionManager Extensions for ONE.core Integration
 *
 * Extends ConnectionManager with invitation, chat, and group chat capabilities
 * based on the test-object-filter.js pattern.
 */

import type { OneCoreAdapter, GroupWithCertificate, SHA256IdHash } from './adapters/OneCoreAdapter.js';
import { ConnectionManager } from './ConnectionManager.js';
import { NotInitializedError, PairingError, GroupError } from './utils/error-handling.js';

/**
 * Extended ConnectionManager with ONE.core integration
 *
 * Adds support for:
 * - Invitation-based pairing
 * - Group creation with attestation certificates
 * - Group chat via Topics
 */
export class ConnectionManagerOneCore extends ConnectionManager {
  /** ONE.core adapter (optional - platforms may not use ONE.core) */
  private oneCore?: OneCoreAdapter;

  /**
   * Set ONE.core adapter
   * Platforms using ONE.core (lama.cube, lama.browser, lama iOS) must call this
   *
   * @param adapter Platform-specific ONE.core adapter implementation
   */
  setOneCoreAdapter(adapter: OneCoreAdapter): void {
    this.oneCore = adapter;

    // Register pairing success callback to create shared 1:1 channels
    adapter.connections.onPairingSuccess(async (
      initiatedLocally,
      localPersonId,
      localInstanceId,
      remotePersonId,
      remoteInstanceId,
      token
    ) => {
      await this.handlePairingSuccess(
        initiatedLocally,
        localPersonId,
        localInstanceId,
        remotePersonId,
        remoteInstanceId,
        token
      );
    });
  }

  /**
   * Create invitation for pairing
   * Pattern from test-object-filter.js:
   * - bobInvitation = await httpRequest(BOB_PORT, '/create-invitation', 'POST')
   *
   * @returns Invitation string to share with peer
   * @throws PairingError if ONE.core adapter not set
   */
  async createInvitation(): Promise<string> {
    this.assertInitialized();
    this.assertOneCore();

    try {
      return await this.oneCore!.connections.createInvitation();
    } catch (error) {
      throw new PairingError(
        `Failed to create invitation: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Accept invitation and establish connection
   * Pattern from test-object-filter.js:
   * - await httpRequest(ALICE_PORT, '/accept-invitation', 'POST', { invitation })
   * - Triggers pairing callback which creates shared 1:1 channel
   *
   * @param invitation Invitation string from peer
   * @throws PairingError if ONE.core adapter not set or acceptance fails
   */
  async acceptInvitation(invitation: string): Promise<void> {
    this.assertInitialized();
    this.assertOneCore();

    try {
      await this.oneCore!.connections.acceptInvitation(invitation);
      // Note: Actual pairing completion handled by callback registered in setOneCoreAdapter()
    } catch (error) {
      throw new PairingError(
        `Failed to accept invitation: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create group with attestation certificate
   * Pattern from test-object-filter.js (lines 262-358):
   * 1. Create HashGroup with members
   * 2. Create Group with name
   * 3. Create License
   * 4. Create AffirmationCertificate
   * 5. Sign certificate
   * 6. Grant access to members
   * 7. Post certificates to 1:1 channels
   *
   * @param name Group name
   * @param members Array of person ID hashes
   * @returns Group info with certificate hashes
   * @throws GroupError if creation fails
   */
  async createGroupWithCertificate(
    name: string,
    members: SHA256IdHash[]
  ): Promise<GroupWithCertificate> {
    this.assertInitialized();
    this.assertOneCore();

    if (members.length < 2) {
      throw new GroupError('Group must have at least 2 members');
    }

    try {
      return await this.oneCore!.attestation.createGroupWithCertificate(name, members);
    } catch (error) {
      throw new GroupError(
        `Failed to create group with certificate: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Share group with member
   * Pattern from test-object-filter.js (lines 361-409):
   * - Posts Group object to shared 1:1 channel with member
   * - Object filter blocks Groups without certificates
   *
   * @param recipientId Recipient person ID
   * @param group Group info with certificates
   * @throws GroupError if sharing fails
   */
  async shareGroupWithMember(
    recipientId: SHA256IdHash,
    group: GroupWithCertificate
  ): Promise<void> {
    this.assertInitialized();
    this.assertOneCore();

    try {
      await this.oneCore!.attestation.shareGroupWithMember(
        recipientId,
        group.groupId,
        {
          certificate: group.certificateId,
          signature: group.signatureId,
          license: group.licenseId
        }
      );
    } catch (error) {
      throw new GroupError(
        `Failed to share group with member ${recipientId.substring(0, 8)}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create group chat topic
   * Pattern from test-object-filter.js (lines 474-491):
   * - topicId = await topicModel.createNewTopic(topicName, members, groupId)
   *
   * @param name Topic name
   * @param members Array of person ID hashes
   * @param groupId Group ID hash
   * @returns Topic ID
   */
  async createGroupChatTopic(
    name: string,
    members: SHA256IdHash[],
    groupId: SHA256IdHash
  ): Promise<string> {
    this.assertInitialized();
    this.assertOneCore();

    try {
      return await this.oneCore!.topics.createNewTopic(name, members, groupId);
    } catch (error) {
      throw new GroupError(
        `Failed to create group chat topic: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Send message to topic
   * Pattern from test-object-filter.js (lines 493-509):
   * - await topicModel.addMessage(topicId, content, authorId)
   *
   * @param topicId Topic ID
   * @param content Message content
   */
  async sendMessage(topicId: string, content: string): Promise<void> {
    this.assertInitialized();
    this.assertOneCore();

    try {
      const myId = await this.oneCore!.leute.myMainIdentity();
      await this.oneCore!.topics.addMessage(topicId, content, myId);
    } catch (error) {
      throw new GroupError(
        `Failed to send message to topic ${topicId.substring(0, 8)}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get messages from topic
   * Pattern from test-object-filter.js (lines 511-526):
   * - messages = await topicModel.getMessagesForTopic(topicId)
   *
   * @param topicId Topic ID
   * @returns Array of messages
   */
  async getMessages(topicId: string) {
    this.assertInitialized();
    this.assertOneCore();

    try {
      return await this.oneCore!.topics.getMessagesForTopic(topicId);
    } catch (error) {
      throw new GroupError(
        `Failed to get messages from topic ${topicId.substring(0, 8)}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Handle pairing success callback
   * Pattern from test-object-filter.js (lines 143-157):
   * - Create shared 1:1 channel with no owner
   * - Channel ID is lexicographically sorted person IDs
   */
  private async handlePairingSuccess(
    initiatedLocally: boolean,
    localPersonId: SHA256IdHash,
    localInstanceId: string,
    remotePersonId: SHA256IdHash,
    remoteInstanceId: string,
    token: string
  ): Promise<void> {
    if (!this.oneCore) {
      return; // Silently skip if ONE.core not configured
    }

    try {
      // Create shared 1:1 channel (no owner)
      const channelId = await this.oneCore.channels.createShared1to1Channel(
        localPersonId,
        remotePersonId
      );

      this.emit('pairingComplete', {
        initiatedLocally,
        localPersonId,
        localInstanceId,
        remotePersonId,
        remoteInstanceId,
        token,
        channelId
      });
    } catch (error) {
      this.emit('error', new PairingError(
        `Failed to create shared channel after pairing: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      ));
    }
  }

  /**
   * Assert that ONE.core adapter is set
   * @throws PairingError if not set
   */
  private assertOneCore(): void {
    if (!this.oneCore) {
      throw new PairingError('ONE.core adapter not set. Call setOneCoreAdapter() first.');
    }
  }
}
