import { createAccess } from '@refinio/one.core/lib/access.js'
import { SET_ACCESS_MODE } from '@refinio/one.core/lib/storage-base-common.js'

/**
 * Grant HashGroup-based access to a P2P channel
 */
export async function grantP2PChannelAccess(
  channelInfoIdHash: any,
  participantsHash: any
): Promise<void> {
  await createAccess([{
    id: channelInfoIdHash,
    person: [],
    hashGroup: [participantsHash],
    mode: SET_ACCESS_MODE.ADD
  }])
}
