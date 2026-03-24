import tweetnacl from 'tweetnacl';
import type {ConnectionIncomingEvent, ConnectionOutgoingEvent} from '../ConnectionPlugin.js';
import ConnectionPlugin from '../ConnectionPlugin.js';
import {
    addPaddingWithExtraFlags,
    removePaddingWithExtraFlags
} from '../../PasswordRecoveryService/padding.js';

/**
 * This class implements an encrypted connection.
 *
 * The key negotiation is done by derived classes, because depending on the
 * side of the conversation (client: initiator of the connection / server:
 * acceptor of the connection) the key exchange procedure changes.
 */
export default class EncryptionPlugin extends ConnectionPlugin {
    private readonly sharedKey: Uint8Array; // The shared key used for encryption
    private localNonceCounter: number = 0; // The counter for the local nonce
    private remoteNonceCounter: number = 0; // The counter for the remote nonce

    /**
     * Creates an encryption layer above the passed websocket.
     *
     * Instantiating this class is not enough. The shared key pairs have to be set up
     * by a derived class through some kind of key negotiation procedure before the encryption
     * actually works.
     *
     * @param sharedKey             - the key used for encryption
     * @param evenLocalNonceCounter - If true the local instance uses even nonces, otherwise odd.
     */
    constructor(sharedKey: Uint8Array, evenLocalNonceCounter: boolean) {
        super('encryption');
        this.sharedKey = sharedKey;

        // For simplicity we will count with the number type and it has a width of 32 bit
        // when doing logic operations (when converting to Uint8Array). So we need to be
        // sure that the nonce length is larger than that, because otherwise we would have
        // overflows which lead to duplicate nonce values.
        if (tweetnacl.box.nonceLength <= 4) {
            throw new Error('We assume the encryption nonce to be larger than 32 bits');
        }

        // Setup the initial nonce related values
        if (evenLocalNonceCounter) {
            this.localNonceCounter = 0;
            this.remoteNonceCounter = 1;
        } else {
            this.localNonceCounter = 1;
            this.remoteNonceCounter = 0;
        }
    }

    public transformIncomingEvent(event: ConnectionIncomingEvent): ConnectionIncomingEvent | null {
        if (event.type !== 'message') {
            return event;
        }

        if (typeof event.data === 'string') {
            console.error(`[EncryptionPlugin] ERROR: Received unencrypted string message:`, event.data.substring(0, 200));
            throw new Error('Incoming encrypted message is a string, it needs to be binary');
        }

        // Step C: Decrypt message
        const decryptedMessage = this.decryptMessage(event.data);

        // Step B: Remove padding
        const unpaddedMessageAndFlags = removePaddingWithExtraFlags(decryptedMessage);

        // Step A: Based on flags determine whether to return a string or an Uint8Array
        const outputIsString = (unpaddedMessageAndFlags.flags & 0x01) === 0x01;
        console.log(`[EncryptionPlugin] transformIncomingEvent - decrypted, outputIsString: ${outputIsString}`);

        if (outputIsString) {
            return {
                type: 'message',
                data: new TextDecoder().decode(unpaddedMessageAndFlags.value)
            };
        } else {
            return {
                type: 'message',
                data: unpaddedMessageAndFlags.value
            };
        }
    }

    public transformOutgoingEvent(event: ConnectionOutgoingEvent): ConnectionOutgoingEvent | null {
        if (event.type !== 'message') {
            return event;
        }

        let flags: number;
        let binaryMessage: Uint8Array;

        // Step A: Determine flag and convert based on type of messsage
        // Lowest flag bit === 1 => string
        // Lowest flag bit === 0 => Uint8Array
        if (typeof event.data === 'string') {
            binaryMessage = new TextEncoder().encode(event.data);
            flags = 0x01;
        } else {
            binaryMessage = event.data;
            flags = 0x00;
        }

        // Step B: Add padding of random length
        // TODO: The randomness is not perfect, because the distribution of the lengths around the
        //  real length might still leak data. Something better would probably be to distribute
        //  around a fixed value (as long as messages are short). Longer messages would then
        //  need special handling.
        const randomByte = tweetnacl.randomBytes(1)[0];
        const paddingLength = binaryMessage.length + 1 + randomByte;
        const paddedMessage = addPaddingWithExtraFlags(
            binaryMessage,
            binaryMessage.length + 1 + randomByte,
            flags
        );

        // Step C: encrypt
        return {
            type: 'message',
            data: this.encryptMessage(paddedMessage)
        };
    }

    /**
     * Encrypt the message using the shared key.
     *
     * @param plainText - The text to encrypt
     * @returns The encrypted text
     */
    private encryptMessage(plainText: Uint8Array): Uint8Array {
        const nonce = this.getAndIncLocalNonce();
        return tweetnacl.box.after(plainText, nonce, this.sharedKey);
    }

    /**
     * Decrypt the cypher text using the shared key.
     *
     * @param cypherText - The text to decrypt
     * @returns The decrypted text
     */
    private decryptMessage(cypherText: Uint8Array): Uint8Array {
        const nonce = this.getAndIncRemoteNonce();
        const plainText = tweetnacl.box.open.after(cypherText, nonce, this.sharedKey);

        if (!plainText) {
            throw new Error('Decryption of message failed.');
        }

        return plainText;
    }

    /**
     * Returns and then increases the local nonce counter.
     */
    private getAndIncLocalNonce(): Uint8Array {
        const nonce = EncryptionPlugin.nonceCounterToArray(this.localNonceCounter);
        this.localNonceCounter += 2;
        return nonce;
    }

    /**
     * Returns and then increases the remote nonce counter.
     */
    private getAndIncRemoteNonce(): Uint8Array {
        const nonce = EncryptionPlugin.nonceCounterToArray(this.remoteNonceCounter);
        this.remoteNonceCounter += 2;
        return nonce;
    }

    /**
     * Converts the nonce counter from number to Uint8Array.
     *
     * The highest supported nonce counter value is Number.MAX_SAFE_INTEGER - 2
     *
     * Public for tests.
     */
    public static nonceCounterToArray(nonceNumber: number): Uint8Array {
        const nonce = new Uint8Array(tweetnacl.box.nonceLength);
        const view = new DataView(nonce.buffer);

        // We need to check that the nonce counter doesn't become too large,
        // otherwise already used nonces might happen.
        // This only happens after 2^53 / 2 message ... which will never happen ...
        // but people need to be aware that duplicate nonces are bad.
        if (nonceNumber >= Number.MAX_SAFE_INTEGER - 1) {
            throw new Error('Nonce counter reached its maximum value.');
        }

        // Set the lowest bits of the nonce array in big endian notation.
        // "- 8", because the setBigUint64 will set 8 bytes. This means that if
        // nonce.length is 24, then bytes 16, 17, 18, 19, 20, 21, 22, 23 will be set.
        view.setBigUint64(nonce.length - 8, BigInt(nonceNumber));
        return nonce;
    }
}
