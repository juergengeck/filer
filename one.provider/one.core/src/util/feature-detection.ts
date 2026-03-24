/**
 * @author AI Assistant
 * @copyright REFINIO GmbH 2024
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module provides feature detection utilities for browser capabilities.
 * @module
 */

/**
 * Check if SharedArrayBuffer is supported in the current environment.
 * This checks both the existence of SharedArrayBuffer and whether it can be instantiated.
 * @returns {boolean} Returns true if SharedArrayBuffer is fully supported, false otherwise.
 */
export function isSharedArrayBufferSupported(): boolean {
    try {
        // Check if SharedArrayBuffer exists without referencing it directly
        return !!(globalThis.SharedArrayBuffer && (new globalThis.SharedArrayBuffer(1)));
    } catch (e) {
        return false;
    }
}

/**
 * Get the most appropriate buffer type based on environment support.
 * @returns {typeof ArrayBuffer | typeof SharedArrayBuffer} Returns SharedArrayBuffer if supported, otherwise ArrayBuffer
 */
export function getBestBufferType(): typeof ArrayBuffer | typeof SharedArrayBuffer {
    return isSharedArrayBufferSupported() ? globalThis.SharedArrayBuffer : ArrayBuffer;
} 