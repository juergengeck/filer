/**
 * Pairing Handler
 *
 * Platform-agnostic business logic for handling pairing completion.
 * Differentiates between P2P and group chat invitations based on received objects.
 */

export interface PairingContext {
  leuteModel: any;
  topicModel: any;
  channelManager: any;
  localPersonId: string;
  remotePersonId: string;
  initiatedLocally: boolean;
}

export interface PairingResult {
  type: 'p2p' | 'group';
  topicRoom: any;
  channelId: string;
}

/**
 * Detect invitation type by checking for Group/GroupMember objects
 *
 * Group chat indicators:
 * - Group object exists for this connection
 * - GroupMember certificates received
 * - Multiple participants expected
 *
 * P2P indicators:
 * - No Group object
 * - Only 2 participants
 */
export async function detectInvitationType(
  context: PairingContext
): Promise<'p2p' | 'group'> {
  const { leuteModel, remotePersonId, localPersonId } = context;

  console.log('[PairingHandler] 🔍 Detecting invitation type...');

  // Check if we have any Group objects that include the remote person
  try {
    // Query for Group objects that might have been received via CHUM
    const groups = await leuteModel.getGroups?.();

    if (groups && groups.length > 0) {
      // Check if any group contains both local and remote person
      for (const group of groups) {
        const members = group.members || [];
        const hasLocal = members.some((m: string) => m === localPersonId);
        const hasRemote = members.some((m: string) => m === remotePersonId);

        if (hasLocal && hasRemote && members.length > 2) {
          console.log('[PairingHandler] ✅ Group invitation detected:',{
            groupId: group.id?.substring(0, 8),
            memberCount: members.length
          });
          return 'group';
        }
      }
    }
  } catch (error) {
    console.log('[PairingHandler] Could not query groups:', error);
  }

  // Default to P2P if no group indicators found
  console.log('[PairingHandler] ✅ P2P invitation detected (2 participants)');
  return 'p2p';
}

/**
 * Handle pairing completion - route to P2P or group topic creation
 */
export async function handlePairingCompletion(
  context: PairingContext
): Promise<PairingResult> {
  console.log('[PairingHandler] 🤝 Handling pairing completion...');
  console.log('[PairingHandler]   Local:', context.localPersonId?.substring(0, 8));
  console.log('[PairingHandler]   Remote:', context.remotePersonId?.substring(0, 8));
  console.log('[PairingHandler]   Initiated locally:', context.initiatedLocally);

  // Detect invitation type
  const invitationType = await detectInvitationType(context);

  if (invitationType === 'group') {
    return await handleGroupInvitation(context);
  } else {
    return await handleP2PInvitation(context);
  }
}

/**
 * Handle P2P invitation - create shared null-owner channel
 */
async function handleP2PInvitation(
  context: PairingContext
): Promise<PairingResult> {
  const { topicModel, channelManager, localPersonId, remotePersonId, initiatedLocally } = context;

  console.log('[PairingHandler] 💬 Creating P2P topic...');

  // Generate P2P channel ID (lexicographically sorted)
  const channelId = localPersonId < remotePersonId
    ? `${localPersonId}<->${remotePersonId}`
    : `${remotePersonId}<->${localPersonId}`;

  // Create P2P topic using TopicModel's createOneToOneTopic
  // This creates a shared channel with null owner
  const topic = await topicModel.createOneToOneTopic(localPersonId, remotePersonId);
  console.log('[PairingHandler] ✅ P2P topic created');

  // Enter the topic room
  const topicRoom = await topicModel.enterTopicRoom(channelId);

  // Ensure channel exists
  await channelManager.createChannel(channelId, null); // null owner for P2P

  console.log('[PairingHandler] ✅ P2P channel ready:', channelId.substring(0, 20));

  return {
    type: 'p2p',
    topicRoom,
    channelId
  };
}

/**
 * Handle group invitation - create owned channel with group access
 */
async function handleGroupInvitation(
  context: PairingContext
): Promise<PairingResult> {
  const { topicModel, channelManager, localPersonId, remotePersonId } = context;

  console.log('[PairingHandler] 👥 Creating group topic...');

  // For group chats, we need to:
  // 1. Get the group that was received via CHUM
  // 2. Create our owned channel with group access
  // 3. Create topic with group participants

  // This will be implemented when we have the group chat creation flow
  throw new Error('Group chat invitations not yet implemented');
}
