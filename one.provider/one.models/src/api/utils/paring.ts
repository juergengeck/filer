import {isInvitation, type Invitation} from '../../misc/ConnectionEstablishment/PairingManager.js';

/**
 * @param invitationLinkOrToken The invitation link (with colon, after which the token is) or the token to pair with.
 * @returns the invitation information
 */
export function getPairingInformation(invitationLinkOrToken: string): Invitation | undefined {
    try {
        let jsonString = invitationLinkOrToken;
        if (invitationLinkOrToken.includes('#')) {
            jsonString = decodeURIComponent(invitationLinkOrToken.split('#')[1]);
        }
        const invitation = JSON.parse(decodeURIComponent(jsonString)) as Invitation;

        if (isInvitation(invitation)) {
            return invitation;
        } else {
            return undefined;
        }
    } catch (_e) {
        return undefined;
    }
}

/**
 * Creates a token from an invitation
 * @param invitation
 * @returns the token
 */
export function createInvitationToken(invitation: Invitation): string {
    const encryptedInformationString = JSON.stringify(invitation);
    return encodeURIComponent(encryptedInformationString);
}
