/**
 * ONE.core Adapter Interface for connection.core
 *
 * This adapter bridges connection.core's platform-agnostic architecture
 * with ONE.core's models (LeuteModel, ChannelManager, ConnectionsModel, TopicModel).
 *
 * Based on test-object-filter.js pattern that demonstrates:
 * - Invitation-based pairing with shared 1:1 channels
 * - Group creation with attestation certificates
 * - Object filtering (Groups without certificates are blocked)
 * - Group chat with Topics and Messages
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks';

// Re-export ONE.core types for convenience
export type { SHA256Hash, SHA256IdHash };

/**
 * Main ONE.core adapter interface
 * Platforms (lama.cube, lama.browser, lama iOS) must provide implementations
 */
export interface OneCoreAdapter {
  /** Identity management via LeuteModel */
  leute: OneCoreLeute;

  /** Channel management via ChannelManager */
  channels: OneCoreChannels;

  /** Connection/pairing management via ConnectionsModel */
  connections: OneCoreConnections;

  /** Topic/messaging management via TopicModel */
  topics: OneCoreTopics;

  /** Attestation/certificate management */
  attestation: OneCoreAttestation;
}

/**
 * Identity management (LeuteModel wrapper)
 */
export interface OneCoreLeute {
  /**
   * Get my main identity (person ID hash)
   * @returns Person ID hash for current user
   */
  myMainIdentity(): Promise<SHA256IdHash>;

  /**
   * Get person's name/display name
   */
  getPersonName(personId: SHA256IdHash): Promise<string>;
}

/**
 * Channel management (ChannelManager wrapper)
 */
export interface OneCoreChannels {
  /**
   * Create a shared 1:1 channel (no owner)
   * Pattern from test: channelId = [person1, person2].sort().join('<->')
   *
   * @param person1 First person ID
   * @param person2 Second person ID
   */
  createShared1to1Channel(
    person1: SHA256IdHash,
    person2: SHA256IdHash
  ): Promise<string>;

  /**
   * Post object to channel (triggers CHUM sync)
   *
   * @param channelId Channel to post to
   * @param objectHash Hash of object to share
   */
  postToChannel(
    channelId: string,
    objectHash: SHA256Hash
  ): Promise<void>;

  /**
   * Get all channels matching criteria
   */
  getMatchingChannelInfos(): Promise<ChannelInfo[]>;
}

export interface ChannelInfo {
  id: string;
  owner: SHA256IdHash | null;
}

/**
 * Connection/pairing management (ConnectionsModel wrapper)
 */
export interface OneCoreConnections {
  /**
   * Create invitation for pairing
   * Pattern from test: invitation string returned
   *
   * @returns Invitation string to share with peer
   */
  createInvitation(): Promise<string>;

  /**
   * Accept invitation and establish connection
   * Pattern from test: triggers pairing flow
   *
   * @param invitation Invitation string from peer
   */
  acceptInvitation(invitation: string): Promise<void>;

  /**
   * Register callback for pairing success
   * Pattern from test: onPairingSuccess callback creates shared 1:1 channel
   *
   * @param callback Called when pairing completes successfully
   */
  onPairingSuccess(
    callback: (
      initiatedLocally: boolean,
      localPersonId: SHA256IdHash,
      localInstanceId: string,
      remotePersonId: SHA256IdHash,
      remoteInstanceId: string,
      token: string
    ) => Promise<void>
  ): void;
}

/**
 * Topic/messaging management (TopicModel wrapper)
 */
export interface OneCoreTopics {
  /**
   * Create a new topic for group chat
   * Pattern from test: topicModel.createNewTopic(name, members, groupId)
   *
   * @param name Topic name
   * @param members Array of person ID hashes
   * @param groupId Optional group ID hash for group chats
   * @returns Topic ID hash
   */
  createNewTopic(
    name: string,
    members: SHA256IdHash[],
    groupId?: SHA256IdHash
  ): Promise<string>;

  /**
   * Add message to topic
   * Pattern from test: topicModel.addMessage(topicId, content, authorId)
   *
   * @param topicId Topic to add message to
   * @param content Message content
   * @param authorId Author person ID
   */
  addMessage(
    topicId: string,
    content: string,
    authorId: SHA256IdHash
  ): Promise<void>;

  /**
   * Get messages for topic
   *
   * @param topicId Topic ID
   * @returns Array of messages
   */
  getMessagesForTopic(topicId: string): Promise<TopicMessage[]>;
}

export interface TopicMessage {
  author: SHA256IdHash;
  content: string;
  timestamp: number;
}

/**
 * Attestation/certificate management
 * Pattern from test: Group → License → AffirmationCertificate → Sign → Grant Access
 */
export interface OneCoreAttestation {
  /**
   * Create a Group with attestation certificate
   * This is the COMPLETE flow from test-object-filter.js:
   * 1. Create HashGroup (unversioned) with members
   * 2. Create Group (versioned) with name and hashGroup
   * 3. Create License object
   * 4. Create AffirmationCertificate pointing to Group
   * 5. Sign certificate
   * 6. Grant access to all certificate objects for members
   * 7. Post certificates to 1:1 channels with each member
   *
   * @param name Group name
   * @param members Array of person ID hashes
   * @returns Group info with certificate hashes
   */
  createGroupWithCertificate(
    name: string,
    members: SHA256IdHash[]
  ): Promise<GroupWithCertificate>;

  /**
   * Share group with member (posts certificates + group to their 1:1 channel)
   *
   * @param recipientId Recipient person ID
   * @param groupId Group ID hash
   * @param certificateIds Certificate hashes (cert, signature, license)
   */
  shareGroupWithMember(
    recipientId: SHA256IdHash,
    groupId: SHA256IdHash,
    certificateIds: CertificateSet
  ): Promise<void>;

  /**
   * Check if group is present locally
   *
   * @param groupId Group ID hash
   * @returns True if group exists locally
   */
  hasGroup(groupId: SHA256IdHash): Promise<boolean>;

  /**
   * Check if certificates are present locally
   *
   * @param certificateIds Set of certificate hashes
   * @returns True if all certificates are present
   */
  hasCertificates(certificateIds: CertificateSet): Promise<boolean>;
}

export interface GroupWithCertificate {
  groupId: SHA256IdHash;
  groupHash: SHA256Hash;
  certificateId: SHA256Hash;
  signatureId: SHA256Hash;
  licenseId: SHA256Hash;
}

export interface CertificateSet {
  certificate: SHA256Hash;
  signature: SHA256Hash;
  license: SHA256Hash;
}
