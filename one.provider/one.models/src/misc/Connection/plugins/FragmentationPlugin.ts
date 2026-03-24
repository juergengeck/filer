import type {ConnectionIncomingEvent, ConnectionOutgoingEvent} from '../ConnectionPlugin.js';
import ConnectionPlugin from '../ConnectionPlugin.js';
import {escapeKeywords, unescapeKeywords} from '../../escapeKeywords.js';

const CHUNK_START_BINARY_MESSAGE = 'fragmentation_start_binary';
const CHUNK_START_STRING_MESSAGE = 'fragmentation_start_string';
const CHUNK_END_MESSAGE = 'fragmentation_end';
const CHUNK_MESSAGES = [CHUNK_START_BINARY_MESSAGE, CHUNK_START_STRING_MESSAGE, CHUNK_END_MESSAGE];

function* fragmentIntoChunks(data: Uint8Array, chunkSize: number): IterableIterator<Uint8Array> {
    for (let i = data.byteOffset; i < data.byteOffset + data.byteLength; i += chunkSize) {
        yield new Uint8Array(
            data.buffer,
            i,
            Math.min(chunkSize, data.byteOffset + data.byteLength - i)
        );
    }
}

/**
 * This plugin chops up the outgoing messages into smaller chunks and reassembles them when
 * receiving.
 *
 * The purpose of this is that we see continuous traffic on slow connections when sending large
 * objects, so that the connections don't time out. This solution can also be used in the future
 * to implement streaming of data.
 */
export default class FragmentationPlugin extends ConnectionPlugin {
    private readonly chunkSize: number; // The shared key used for encryption
    private processingBinaryChunk = false;
    private processingStringChunk = false;
    private chunkAccumulator: Uint8Array[] = [];

    /**
     * Creates an encryption layer above the passed websocket.
     *
     * Instantiating this class is not enough. The shared key pairs have to be set up
     * by a derived class through some kind of key negotiation procedure before the encryption
     * actually works.
     *
     * @param chunkSize
     */
    constructor(chunkSize: number) {
        super('fragmentation');
        this.chunkSize = chunkSize;
    }

    public transformIncomingEvent(event: ConnectionIncomingEvent): ConnectionIncomingEvent | null {
        if (event.type !== 'message') {
            return event;
        }

        if (typeof event.data === 'string') {
            if (event.data === CHUNK_START_STRING_MESSAGE) {
                this.startStringChunkProcessing();
                return null;
            }

            if (event.data === CHUNK_START_BINARY_MESSAGE) {
                this.startBinaryChunkProcessing();
                return null;
            }

            if (event.data === CHUNK_END_MESSAGE) {
                this.endChunkProcessing();
                return null;
            }

            if (this.processingStringChunk) {
                throw new Error(
                    `Currently processing string chunks. No string messages allowed except the ${CHUNK_END_MESSAGE} message.`
                );
            }

            if (this.processingBinaryChunk) {
                throw new Error(
                    `Currently processing binary chunks. No string messages allowed except the ${CHUNK_END_MESSAGE} message.`
                );
            }

            return {
                type: 'message',
                data: unescapeKeywords(CHUNK_MESSAGES, event.data)
            };
        }

        if (this.processingStringChunk || this.processingBinaryChunk) {
            this.processChunk(event.data);
            return null;
        }

        return event;
    }

    public transformOutgoingEvent(event: ConnectionOutgoingEvent): ConnectionOutgoingEvent | null {
        if (event.type !== 'message') {
            return event;
        }

        let data;

        if (typeof event.data === 'string') {
            // Check if the utf8 representation of the string (websocket will transfer as utf-8)
            // is potentially larger than the chunk size. If it is not transfer as string, if it
            // is, transfer as bytes. (worst case one unicode char has 4 bytes)
            // The highest unicode codepoint is 0x10FFFF so you have 0x110000 values that must be
            // represented. This fit in 21 bits. Those 21 bits are encoded in a way, so that
            // you can only use roughly 6 bits per byte, so 4 bytes is the maximum. In theory /
            // an old version could go up to 6 bytes, but this is not the case since 2003
            // (RFC-3629).
            // The < instead of <= because the escaping might need another byte.
            if (event.data.length < this.chunkSize / 4) {
                return {
                    type: 'message',
                    data: escapeKeywords(CHUNK_MESSAGES, event.data)
                };
            }

            // Step 1: START BINARY CHUNK
            this.eventCreationFunctions.createOutogingEvent({
                type: 'message',
                data: CHUNK_START_STRING_MESSAGE
            });
            data = new TextEncoder().encode(event.data);
        } else {
            if (event.data.length <= this.chunkSize) {
                return {
                    type: 'message',
                    data: event.data
                };
            }

            // Step 1: START BINARY CHUNK
            this.eventCreationFunctions.createOutogingEvent({
                type: 'message',
                data: CHUNK_START_BINARY_MESSAGE
            });
            data = event.data;
        }

        // Step 2: Send fragments
        for (const fragment of fragmentIntoChunks(data, this.chunkSize)) {
            this.eventCreationFunctions.createOutogingEvent({
                type: 'message',
                data: fragment
            });
        }

        // Step 3: Send chunk end message
        this.eventCreationFunctions.createOutogingEvent({
            type: 'message',
            data: CHUNK_END_MESSAGE
        });

        return null;
    }

    private startStringChunkProcessing() {
        if (this.processingStringChunk) {
            throw new Error(
                `Already processing string chunks. ${CHUNK_START_STRING_MESSAGE} message not allowed.`
            );
        }
        if (this.processingBinaryChunk) {
            throw new Error(
                `Already processing binary chunks. ${CHUNK_START_STRING_MESSAGE} message not allowed.`
            );
        }

        this.processingStringChunk = true;
        this.chunkAccumulator = [];
    }

    private startBinaryChunkProcessing() {
        if (this.processingStringChunk) {
            throw new Error(
                `Already processing string chunks. ${CHUNK_START_BINARY_MESSAGE} message not allowed.`
            );
        }
        if (this.processingBinaryChunk) {
            throw new Error(
                `Already processing binary chunks. ${CHUNK_START_BINARY_MESSAGE} message not allowed.`
            );
        }

        this.processingBinaryChunk = true;
        this.chunkAccumulator = [];
    }

    private endChunkProcessing() {
        if (!this.processingStringChunk && !this.processingBinaryChunk) {
            throw new Error(
                `No chunks processing in progress. ${CHUNK_END_MESSAGE} message not allowed.`
            );
        }

        const totalLength = this.chunkAccumulator.reduce(
            (lengthAccu, chunk) => lengthAccu + chunk.length,
            0
        );
        const accumulatedMessage = new Uint8Array(totalLength);
        this.chunkAccumulator.reduce((lengthAccu, chunk) => {
            accumulatedMessage.set(chunk, lengthAccu);
            return lengthAccu + chunk.length;
        }, 0);

        if (this.processingStringChunk) {
            this.eventCreationFunctions.createIncomingEvent({
                type: 'message',
                data: new TextDecoder().decode(accumulatedMessage)
            });
        }

        if (this.processingBinaryChunk) {
            this.eventCreationFunctions.createIncomingEvent({
                type: 'message',
                data: accumulatedMessage
            });
        }

        this.processingBinaryChunk = false;
        this.processingStringChunk = false;
        this.chunkAccumulator = [];
    }

    private processChunk(data: Uint8Array) {
        this.chunkAccumulator.push(data);
    }
}
