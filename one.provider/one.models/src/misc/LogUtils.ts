/**
 * Creates a string that identifies the websocket.
 *
 * Perfect for writing debug messages, but imperfect for privacy. We should use pseudonyms for the debugging case and
 * <redacted> for productive versions.
 *
 * @param ws - The websocket instance for which to generate the identifier.
 * @returns
 */
import {uint8arrayToHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';

export function wslogId(ws: WebSocket | null): string {
    // TODO: We should use pseudonyms based on an hashing algorithm or something, because we don't want to
    //  have ip addresses in the logs.

    try {
        if (!ws || !(ws as any)._socket) {
            return '<noinfo>';
        }

        return (
            (ws as any)._socket.remoteAddress.toString() + ':' + (ws as any).remotePort.toString()
        );
    } catch (e) {
        return '<noinfo>';
    }
}

/**
 * This prints the contents of the passed array buffer as hex values to the console.
 *
 * Good for debugging stuff.
 *
 * @param name - Name that is prepended
 * @param data - The data to print
 */
export function printUint8Array(name: string, data: Uint8Array): void {
    console.log(' ---- ' + name + ': ' + uint8arrayToHexString(data));
}
