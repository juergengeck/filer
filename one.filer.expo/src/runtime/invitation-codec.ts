import type {Invitation} from '@refinio/one.models/lib/misc/ConnectionEstablishment/PairingManager.js';

export type InvitationMode = 'IoM' | 'IoP';

const ROUTES: Record<InvitationMode, string> = {
    IoM: '/invites/inviteDevice',
    IoP: '/invites/invitePartner'
};

const BASE_URL = 'https://one.filer';

function assertInvitation(value: unknown): asserts value is Invitation {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invitation must be an object');
    }
    const invitation = value as Record<string, unknown>;
    for (const field of ['token', 'publicKey', 'url']) {
        if (typeof invitation[field] !== 'string' || (invitation[field] as string).length === 0) {
            throw new Error(`Invitation is missing required field '${field}'`);
        }
    }
}

/**
 * Accept a standard ONE invitation URL (`https://…#<url-encoded JSON>` or
 * `one://…#<encoded>`, as produced by desktop Filer, VGER and Fotos) or raw
 * invitation JSON. Mirrors the `ConnectionPlan` accept-side format.
 */
export function parseInvitationInput(raw: string): Invitation {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('Invitation is empty');
    const hashIndex = trimmed.indexOf('#');
    const encoded = hashIndex === -1 ? trimmed : trimmed.substring(hashIndex + 1);
    let parsed: unknown;
    try {
        parsed = JSON.parse(decodeURIComponent(encoded));
    } catch {
        throw new Error('Invitation is neither a valid ONE invitation URL nor valid JSON');
    }
    assertInvitation(parsed);
    return parsed;
}

/**
 * Format a created invitation as a standard ONE invitation URL so it can be
 * shared with desktop Filer, VGER and Fotos. The accept side rewrites the
 * origin to its own web URL; the path selects the IoM/IoP mode.
 */
export function formatInvitationUrl(invitation: Invitation, mode: InvitationMode): string {
    assertInvitation(invitation);
    const token = encodeURIComponent(JSON.stringify(invitation));
    const route = ROUTES[mode];
    try {
        const base = new URL(BASE_URL);
        const normalized = base.pathname.toLowerCase();
        const alreadyRouted =
            /\/(?:invites\/)?invitedevice\/?$/.test(normalized) ||
            /\/(?:invites\/)?invitepartner\/?$/.test(normalized);
        if (!alreadyRouted) base.pathname = `${base.pathname.replace(/\/+$/, '')}${route}`;
        base.searchParams.set('invited', 'true');
        base.hash = token;
        return base.toString();
    } catch {
        return `${BASE_URL}${route}?invited=true#${token}`;
    }
}
