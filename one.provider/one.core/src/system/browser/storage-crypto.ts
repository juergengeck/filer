/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @private
 * @module
 */

import {randomBytes, secretbox} from 'tweetnacl';

import {createError} from '../../errors.js';
import {STORAGE} from '../../storage-base-common.js';
import {isString} from '../../util/type-checks-basic.js';
import {deriveBinaryKey} from './crypto-scrypt.js';
import {getDbInstance} from './storage-base.js';
import {getArrayBuffer, getUint8Array} from '../../util/buffer.js';
import {isSharedArrayBufferSupported} from '../../util/feature-detection.js';

/**
 * @private
 * @typedef {object} KeysAndNonce
 * @property {Uint8Array} storageEncryptionKey
 * @property {Uint8Array} filenameEncryptionKey
 * @property {Uint8Array} filenameNonce
 */
interface KeysAndNonce {
    storageEncryptionKey: Uint8Array;
    filenameEncryptionKey: Uint8Array;
    filenameNonce: Uint8Array;
}

// Loaded by initEncryption(), kept in RAM
let storageEncryptionKey: null | Uint8Array = null;
let filenameEncryptionKey: null | Uint8Array = null;
// All filenames (hashes) use the same nonce
let filenameNonce: null | Uint8Array = null;

// For encryption, to translate between Uint8Array and string. No need to create a new instance
// every time.
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// Because of encryption everything is stored as ArrayBuffer inside the IndexedDB. We need to
// return the contents in the original form - strings or ArrayBuffer, so we add a flag to the
// encrypted message to know how to handle the contents after decryption. Binary contents is
// returned as-is as ArrayBuffer, if it is supposed to be a string the ArrayBuffer is UTF-8
// text-decoded and converted into a string.
const BINARY = 0;
const STRING = 1;

/**
 * Returns an approximate size of an encrypted value without decrypting it. Because we don't
 * decrypt it the size can only be an approximation, since each buffer has a random padding. We
 * simply assume the middle value of the maximum padding size. Since padding lengths should be
 * about equally distributed using the middle value will yield the best results on average.
 *
 * The result will be within 16 bytes of the true size, plus or minus.
 * @internal
 * @static
 * @param {ArrayBufferLike | Uint8Array} encrypted
 * @returns {number}
 */
export function getApproxSize(encrypted: ArrayBufferLike | Uint8Array): number {
    // OUTER BOX
    // 1. Nonce
    // 2. Overhead (signed and encrypted)

    // INNER BOX
    // 1. Padding array length 1 byte [0::256] The value is divided by 8 to get actual padding.
    // 2. VARIABLE: Padding - random length, [0..256/8]
    //    That means the maximum padding length is 32, and the middle value is 16 (as we should
    //    have an equal distribution of values).
    // 3. Flag 1 byte: string or ArrayBuffer?

    return encrypted.byteLength - secretbox.nonceLength - secretbox.overheadLength - 18;
}

/**
 * @internal
 * @static
 * @param {string} key
 * @returns {ArrayBuffer} Returns an `ArrayBuffer` `nacl.secretbox.overheadLength = 16` larger than the input
 */
export function encryptKey(key: string): ArrayBuffer {
    if (filenameEncryptionKey === null) {
        throw createError('SC-EK1');
    }

    if (filenameNonce === null) {
        throw createError('SC-EK2');
    }

    const encryptedKey = secretbox(ENCODER.encode(key), filenameNonce, filenameEncryptionKey);

    return getArrayBuffer(
        encryptedKey.buffer.slice(
            encryptedKey.byteOffset,
            encryptedKey.byteOffset + encryptedKey.byteLength
        )
    );
}

/**
 * @internal
 * @static
 * @param {ArrayBufferLike | Uint8Array} encryptedKey - An encrypted IndexedDB key/filename
 * @returns {string}
 */
export function decryptKey(encryptedKey: ArrayBufferLike | Uint8Array): string {
    if (filenameEncryptionKey === null) {
        throw createError('SC-DK1');
    }

    if (filenameNonce === null) {
        throw createError('SC-DK2');
    }

    const decryptedKey = secretbox.open(
        getUint8Array(encryptedKey),
        filenameNonce,
        filenameEncryptionKey
    );

    if (decryptedKey === null) {
        throw createError('SC-DK3');
    }

    return DECODER.decode(decryptedKey);
}

/**
 * @internal
 * @static
 * @param {string | ArrayBufferLike | Uint8Array} contents
 * @returns {ArrayBuffer}
 */
export function encrypt(contents: string | ArrayBufferLike | Uint8Array): ArrayBuffer {
    if (storageEncryptionKey === null) {
        throw createError('SC-ENC1');
    }

    const contentsBuf = isString(contents) ? ENCODER.encode(contents) : getUint8Array(contents);

    // MINOR TRICK: Use the one byte reserved to store the padding length completely. Since
    // padding length always is at the same position in the source buffer, if it is not
    // completely random it would take away a tiny bit from the encryption strength. So we use
    // all possible values for the byte, but we don't want to have the actual padding be of that
    // length. Decryption has to do the same of course.
    // [0..255] so that the number fits into one byte...
    // ...but divide by 8 (=32 max padding length) to save space
    const paddingLength = Math.floor(Math.random() * 256);
    const padding = randomBytes(paddingLength >>> 3);

    // 1. Padding array length 1 byte [PADDING_MIN...PADDING_MAX]
    // 2. Padding array - random length, random bytes
    // 3. Flag 1 byte: string or ArrayBuffer?
    // 4. Content - the actual content, an ArrayBuffer (BLOB) or a string (CLOB or microdata)
    const innerBox = new Uint8Array(2 + padding.byteLength + contentsBuf.byteLength);
    innerBox.set([paddingLength], 0);
    innerBox.set(padding, 1);
    innerBox.set([isString(contents) ? STRING : BINARY], 1 + padding.byteLength);
    innerBox.set(contentsBuf, 2 + padding.byteLength);

    const nonce = randomBytes(secretbox.nonceLength);
    const encryptedContents = secretbox(innerBox, nonce, storageEncryptionKey);

    const outerBox = new Uint8Array(nonce.byteLength + encryptedContents.byteLength);

    // 1. Nonce
    // 2. Content Box (padding length, padding, text flag, actual content)
    outerBox.set(nonce);
    outerBox.set(encryptedContents, nonce.byteLength);

    // TODO The offset calculation should not be necessary, since we allocate the Uint8Array here without using an
    //  existing ArrayBuffer
    return outerBox.buffer.slice(outerBox.byteOffset, outerBox.byteOffset + outerBox.byteLength);
}

/**
 * @internal
 * @static
 * @param {ArrayBufferLike | Uint8Array} contents
 * @returns {ArrayBuffer | string}
 */
export function decrypt(contents: ArrayBufferLike | Uint8Array): ArrayBuffer | string {
    if (storageEncryptionKey === null) {
        throw createError('SB-DEC1');
    }

    // Check if the input is a valid buffer type
    if (!(
        contents instanceof ArrayBuffer ||
        (isSharedArrayBufferSupported() && contents instanceof SharedArrayBuffer) ||
        contents instanceof Uint8Array
    )) {
        throw createError('SB-DEC2', {type: typeof contents});
    }

    const outerBox = getUint8Array(contents);
    const innerBox = secretbox.open(
        outerBox.slice(secretbox.nonceLength),
        outerBox.slice(0, secretbox.nonceLength),
        storageEncryptionKey
    );

    if (innerBox === null) {
        throw createError('SC-DEC3');
    }

    const paddingLength = innerBox[0] >>> 3;
    const textFlag = innerBox[paddingLength + 1];

    if (textFlag !== STRING && textFlag !== BINARY) {
        throw createError('SC-DEC4', {textFlag, S: STRING, B: BINARY});
    }

    const message = innerBox.slice(2 + paddingLength);

    return textFlag === STRING
        ? DECODER.decode(message)
        : message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength);
}

function readPrivate(filename: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const transaction = getDbInstance().transaction(STORAGE.PRIVATE);

        transaction.onerror = () =>
            reject(createError('SC-READ1', {err: transaction.error, filename}));

        const objectStore = transaction.objectStore(STORAGE.PRIVATE);
        const request = objectStore.get(filename);

        request.onerror = () => reject(createError('SC-READ2', {err: transaction.error, filename}));

        request.onsuccess = () =>
            request.result === undefined
                ? reject(
                      createError('SC-READ3', {
                          name: 'FileNotFoundError',
                          filename,
                          type: STORAGE.PRIVATE
                      })
                  )
                : resolve(request.result);
    });
}

function writePrivate(filename: string, contents: ArrayBufferLike | Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = getDbInstance().transaction(STORAGE.PRIVATE, 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(createError('SC-WRITE1', transaction.error));

        const objectStore = transaction.objectStore(STORAGE.PRIVATE);
        objectStore.add(getArrayBuffer(contents), filename);
    });
}

/**
 * Used to create a new random key or nonce, and then save them in the IndexedDB under the given
 * name, encrypted using the given secret-derived symmetric key.
 * @private
 * @static
 * @param {Uint8Array | ArrayBufferLike} keyFromSecret - The key derived from the user's "secret"
 * @param {string} name - IndexedDB key/filename to store the created key under
 * @param {number} [length=secretbox.keyLength]
 * @returns {Promise<Uint8Array>}
 */
async function createRandomBufAndSaveEncrypted(
    keyFromSecret: Uint8Array | ArrayBufferLike,
    name: string,
    length: number = secretbox.keyLength
): Promise<Uint8Array> {
    const nonce = randomBytes(secretbox.nonceLength);
    const msg = randomBytes(length);
    const encrypted = secretbox(msg, nonce, getUint8Array(keyFromSecret));

    const box = new Uint8Array(nonce.byteLength + encrypted.byteLength);
    box.set(nonce, 0);
    box.set(encrypted, nonce.byteLength);

    // TODO The offset calculation should not be necessary, since we allocate the Uint8Array here without using an
    //  existing ArrayBuffer
    await writePrivate(name, box.buffer.slice(box.byteOffset, box.byteOffset + box.byteLength));

    return msg;
}

/**
 * @private
 * @static
 * @param {Uint8Array | ArrayBufferLike} keyFromSecret - The key derived from the user's "secret"
 * @param {string} filename - IndexedDB key/filename to load the encrypted key from
 * @returns {Promise<Uint8Array>}
 */
async function loadKey(
    keyFromSecret: Uint8Array | ArrayBufferLike,
    filename: string
): Promise<Uint8Array> {
    const box = new Uint8Array(await readPrivate(filename));
    const nonce = box.slice(0, secretbox.nonceLength);
    const encrypted = box.slice(secretbox.nonceLength);
    const decrypted = secretbox.open(encrypted, nonce, getUint8Array(keyFromSecret));

    if (decrypted === null) {
        throw createError('SC-LDENC', {filename});
    }

    return decrypted;
}

/**
 * @private
 * @param {string} secret - The string will be
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize|normalized}.
 * @returns {Promise<KeysAndNonce>}
 */
async function loadKeys(secret: string): Promise<KeysAndNonce> {
    const nonceForKeyFromSecret = new Uint8Array(await readPrivate('SN'));
    const derivedKey = await deriveBinaryKey(secret, nonceForKeyFromSecret, secretbox.keyLength);

    return {
        storageEncryptionKey: await loadKey(derivedKey, 'SK'),
        filenameNonce: new Uint8Array(await loadKey(derivedKey, 'FN')),
        filenameEncryptionKey: await loadKey(derivedKey, 'FK')
    };
}

/**
 * @private
 * @param {string} secret - The string will be
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize|normalized}.
 * @returns {Promise<KeysAndNonce>}
 */
async function createKeys(secret: string): Promise<KeysAndNonce> {
    const nonceForKeyFromSecret = randomBytes(secretbox.nonceLength);
    const derivedKey = await deriveBinaryKey(secret, nonceForKeyFromSecret, secretbox.keyLength);

    // SN, Nonce for the secret-derived key, remains unencrypted, by necessity
    await writePrivate(
        'SN',
        nonceForKeyFromSecret.buffer.slice(
            nonceForKeyFromSecret.byteOffset,
            nonceForKeyFromSecret.byteOffset + nonceForKeyFromSecret.byteLength
        )
    );

    // SK, FN, FK are stored encrypted using the secret-derived key
    return {
        storageEncryptionKey: await createRandomBufAndSaveEncrypted(derivedKey, 'SK'),
        filenameNonce: await createRandomBufAndSaveEncrypted(
            derivedKey,
            'FN',
            secretbox.nonceLength
        ),
        filenameEncryptionKey: await createRandomBufAndSaveEncrypted(derivedKey, 'FK')
    };
}

/**
 * Loads or creates the storage encryption key. It is stored as [nonce, EncryptedKey] ArrayBuffer].
 * They key is encrypted using a key derived from the secret and the stored nonce.
 * This loads or creates the following files:
 * - "SN": Nonce for key-from-secret derivation PLAIN([nonce]). This nonce plus the "secret"
 *   are used to derive a key, and that key is used to en/decrypt the storage key, the filename
 *   key, and the filename nonce.
 * - "SK": Storage encryption key encryptedWithKeyFromSecret([nonce, sKey])
 * - "FK": Filename encryption key encryptedWithKeyFromSecret([nonce, fKey])
 * - "FN": Filename encryption nonce encryptedWithKeyFromSecret([nonce, fnNonce]). The same
 *   nonce is used for encrypting all filenames. Since those are random SHA-256 hashes the loss
 *   of safety by using a single nonce should not be too bad. The nonce needs to be predictable
 *   for filename lookups, when the filename is already known and the encrypted filename needs
 *   to be found. The alternative would be an encrypted file with a map filename => encrypted
 *   filename (the IndexedDB key) that would have to be kept in RAM.
 * @internal
 * @static
 * @param {string} secret - The string will be
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize|normalized}.
 * @returns {Promise<undefined>}
 */
export async function initEncryption(secret: string): Promise<void> {
    try {
        ({storageEncryptionKey, filenameEncryptionKey, filenameNonce} = await loadKeys(secret));
    } catch (err) {
        if (err.name !== 'FileNotFoundError') {
            throw createError('SC-INIT1', err);
        }

        ({storageEncryptionKey, filenameEncryptionKey, filenameNonce} = await createKeys(secret));
    }
}

/**
 * Encrypt the given key or nonce with the given secret (which is the new secret in password
 * change). Save the encrypted buffer under the given name, after removing its predecessor.
 * Keeping a backup should be unnecessary since it all happens in one transaction.
 * @private
 * @param {Uint8Array | ArrayBufferLike} keyFromSecret
 * @param {Uint8Array | ArrayBufferLike} key
 * @param {string} filename
 * @param {IDBObjectStore} objectStore
 * @param {function():void} cb - Callback function to execute when done
 */
function saveEncrypted(
    keyFromSecret: Uint8Array | ArrayBufferLike,
    key: Uint8Array | ArrayBufferLike,
    filename: string,
    objectStore: IDBObjectStore,
    cb: (...p: any[]) => void
): void {
    const nonce = randomBytes(secretbox.nonceLength);
    const encrypted = secretbox(getUint8Array(key), nonce, getUint8Array(keyFromSecret));

    const box = new Uint8Array(nonce.byteLength + encrypted.byteLength);
    box.set(nonce, 0);
    box.set(encrypted, nonce.byteLength);

    objectStore.delete(filename).onsuccess = () => {
        objectStore.add(
            // TODO The offset calculation should not be necessary, since we allocate the Uint8Array here without
            //  using an existing ArrayBuffer
            box.buffer.slice(box.byteOffset, box.byteOffset + box.byteLength),
            filename
        ).onsuccess = cb;
    };
}

/**
 * This function executes the password change for the three files filename encryption key (FK),
 * storage encryption key (SK) and filename nonce (FN) in a single transaction.
 * The function avoids promises and uses regular promises to ensure the transaction remains
 * alive, which on some browsers would not be guaranteed if using promises (some, or all?, Safari
 * versions at the very least). Callbacks have less overhead anyway.
 * @private
 * @param {Uint8Array | ArrayBufferLike} derivedKey
 * @param {Uint8Array | ArrayBufferLike} fk
 * @param {Uint8Array | ArrayBufferLike} fn
 * @param {Uint8Array | ArrayBufferLike} sk
 * @returns {Promise<void>}
 */
function executePwChange(
    derivedKey: Uint8Array | ArrayBufferLike,
    fk: Uint8Array | ArrayBufferLike,
    fn: Uint8Array | ArrayBufferLike,
    sk: Uint8Array | ArrayBufferLike
): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = getDbInstance().transaction(STORAGE.PRIVATE, 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(createError('SC-SAVE1', transaction.error));

        const objectStore = transaction.objectStore(STORAGE.PRIVATE);

        saveEncrypted(derivedKey, fk, 'FK', objectStore, () =>
            saveEncrypted(derivedKey, fn, 'FN', objectStore, () =>
                saveEncrypted(derivedKey, sk, 'SK', objectStore, () => resolve())
            )
        );
    });
}

/**
 * @private
 * @internal
 * @async
 * @param {string} oldSecret
 * @param {string} newSecret
 * @returns {Promise<void>}
 */
export async function _changeStoragePassword(oldSecret: string, newSecret: string): Promise<void> {
    const {
        filenameEncryptionKey: fk,
        filenameNonce: fn,
        storageEncryptionKey: sk
    } = await loadKeys(oldSecret);

    const nonceForKeyFromSecret = new Uint8Array(await readPrivate('SN'));
    const derivedKey = await deriveBinaryKey(newSecret, nonceForKeyFromSecret, secretbox.keyLength);

    await executePwChange(derivedKey, fk, fn, sk);
}
