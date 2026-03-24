/**
 * Ensure that a Uint8Array is backed by an ArrayBuffer.
 * Needed for code that uses old version of typescript.
 *
 * @param {Uint8Array} uint8Array
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function ensureUint8ArrayisArrayBuffer(uint8Array: Uint8Array): Uint8Array<ArrayBuffer> {
    if (uint8Array.buffer instanceof ArrayBuffer) {
        return uint8Array as Uint8Array<ArrayBuffer>;
    }

    const arrayBuffer = new ArrayBuffer(uint8Array.byteLength);
    const output = new Uint8Array(arrayBuffer);
    output.set(uint8Array);
    return output;
}

/**
 * Ensure that a Buffer is backed by an Uint8Array.
 * Needed for code that uses old version of typescript.
 *
 * @param {SharedArrayBuffer | ArrayBuffer | Uint8Array} buffer
 * @returns {Uint8Array}
 */
export function getUint8Array(buffer: SharedArrayBuffer | ArrayBuffer | Uint8Array): Uint8Array {
    if (buffer instanceof Uint8Array) {
        // Handle compound buffers from Node.js ws library
        // If the byteOffset is not 0, we need to create a proper slice
        if (buffer.byteOffset !== 0 || buffer.byteLength !== buffer.buffer.byteLength) {
            // Create a new Uint8Array with just the actual data
            const result = new Uint8Array(buffer.byteLength);
            result.set(buffer);
            return result;
        }
        return buffer;
    }

    // For ArrayBuffer, create a Uint8Array view
    // Make sure we handle the full buffer correctly
    const uint8 = new Uint8Array(buffer);
    if (uint8.byteOffset !== 0 || uint8.byteLength !== uint8.buffer.byteLength) {
        const result = new Uint8Array(uint8.byteLength);
        result.set(uint8);
        return result;
    }
    return uint8;
}

/**
 * Ensure that a Buffer is backed by an ArrayBuffer.
 * Needed for code that uses old version of typescript.
 *
 * @param {Buffer} buffer
 * @returns {ArrayBuffer}
 */
export function getArrayBufferFromBuffer(buffer: Buffer): ArrayBuffer {
    if (buffer.buffer instanceof ArrayBuffer) {
        return buffer.buffer;
    }

    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    const output = new Uint8Array(arrayBuffer);
    output.set(buffer);
    return output.buffer;
}

/**
 * Ensure that a Buffer is backed by an ArrayBuffer.
 * Needed for code that uses old version of typescript.
 * If the input is a SharedArrayBuffer and the environment doesn't support it,
 * it will be converted to a regular ArrayBuffer.
 *
 * @param {SharedArrayBuffer | ArrayBuffer | Uint8Array} buffer
 * @returns {ArrayBuffer}
 */
export function getArrayBuffer(buffer: SharedArrayBuffer | ArrayBuffer | Uint8Array): ArrayBuffer {
    if (buffer instanceof ArrayBuffer) {
        return buffer;
    }

    if (buffer instanceof Uint8Array) {
        return ensureUint8ArrayisArrayBuffer(buffer).buffer;
    }

    // For SharedArrayBuffer, we need to copy the data to a regular ArrayBuffer
    const copy = new Uint8Array(buffer);
    const output = new ArrayBuffer(copy.length);
    new Uint8Array(output).set(copy);
    return output;
}

// Export types for TypeScript
export type BufferTypes = SharedArrayBuffer | ArrayBuffer | Uint8Array;
