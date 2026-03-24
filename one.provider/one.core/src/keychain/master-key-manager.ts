/**
 * @author Erik Haßlmeyer <erik.hasslmeyer@refinio.net>
 * @copyright REFINIO GmbH 2022
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import type {Salt, SymmetricKey} from '../crypto/encryption.js';
import {
    createRandomSalt,
    createSymmetricKey,
    deriveSymmetricKeyFromSecret,
    ensureSalt,
    ensureSymmetricKey,
    symmetricDecryptWithEmbeddedNonce,
    symmetricEncryptAndEmbedNonce
} from '../crypto/encryption.js';
import {createError} from '../errors.js';
import {STORAGE} from '../storage-base-common.js';
import {deleteFile} from '../system/storage-base-delete-file.js';
import {readPrivateBinaryRaw, writePrivateBinaryRaw} from '../system/storage-base.js';

/**
 * This class encapsulates the master key in such a way that it is harder to be leaked.
 *
 * The reason why it is a class and not a simple module is, so that we can move it to another
 * file without exposing the functions to other modules except the keychain. Other files can use
 * it, but they won't be able to decrypt stuff because they don't have access to the object that
 * holds the real master key.
 *
 * The master key is stored in a file that is encrypted. The encryption is done by another key
 * that is derived from the secret that is supplied by the user. This derivation needs a salt,
 * that also stored in a file. So the loading process of the master key works like this:
 * 1) load the salt file
 * 2) derive a symmetric encryption key from the secret and the salt
 * 3) load the master key file
 * 4) decrypt the master key with the derived symmetric key and store it in memory until it is
 * unloaded
 */
export class MasterKeyManager {
    #masterKey: SymmetricKey | null = null;
    readonly #masterKeyFileName: string;
    readonly #saltFileName: string;

    /**
     * Constructs a new master key manager.
     *
     * @param {string} masterKeyFileName - File that stores the encrypted master key
     * @param {string} saltFileName - File that stores the salt for deriving the encryption key
     * from the secret
     */
    constructor(masterKeyFileName: string, saltFileName: string) {
        this.#masterKeyFileName = masterKeyFileName;
        this.#saltFileName = saltFileName;
    }

    // ######## loading / unloading of master key ########

    /**
     * Loads the stored master key or create a new one if none was previously created.
     *
     * This will calculate a derived key from the secret and then:
     * - master-key file missing: create a new master-key + file encrypted with this derived key
     * - master-key file exists: load the master-key from file and decrypt it with this derived key
     *
     * Function will throw if the secret does not match the already existing master-key file.
     *
     * @param {string} secret
     * @returns {Promise<void>}
     */
    public async loadOrCreateMasterKey(secret: string): Promise<void> {
        if (this.#masterKey !== null) {
            throw createError('KEYMKM-HASKEY');
        }

        try {
            this.#masterKey = await MasterKeyManager.loadAndDecodeMasterKey(
                secret,
                this.#masterKeyFileName,
                this.#saltFileName
            );
        } catch (e) {
            if (e.name !== 'FileNotFoundError') {
                throw e;
            }

            const masterKey = createSymmetricKey();
            await MasterKeyManager.writeAndEncodeMasterKey(
                secret,
                masterKey,
                this.#masterKeyFileName,
                this.#saltFileName
            );
            this.#masterKey = masterKey;
        }
    }

    /**
     * Purges the memory from memory.
     */
    public unloadMasterKey(): void {
        if (this.#masterKey === null) {
            return;
        }

        this.#masterKey.fill(0);
        this.#masterKey = null;
    }

    /**
     * Ensures, that the master is loaded, if not it throws.
     */
    public ensureMasterKeyLoaded(): void {
        if (this.#masterKey === null) {
            throw createError('KEYMKM-NOKEY');
        }
    }

    /**
     * Changes the secret needed to unlock the master-key.
     *
     * This can be done with or without a loaded master key. Throws if the oldSecret is wrong.
     *
     * @param {string} oldSecret
     * @param {string} newSecret
     * @returns {Promise<void>}
     */
    public async changeSecret(oldSecret: string, newSecret: string): Promise<void> {
        const masterKey = await MasterKeyManager.loadAndDecodeMasterKey(
            oldSecret,
            this.#masterKeyFileName,
            this.#saltFileName
        );
        await MasterKeyManager.writeAndEncodeMasterKey(
            newSecret,
            masterKey,
            this.#masterKeyFileName,
            this.#saltFileName
        );
    }

    // ######## encryption / decryption with master key ########

    /**
     * Encrypt data with the master key.
     *
     * Only works if the master key was previously set.
     *
     * @param {Uint8Array | ArrayBufferLike} data
     * @returns {Uint8Array}
     */
    public encryptDataWithMasterKey(data: Uint8Array | ArrayBufferLike): Uint8Array {
        if (this.#masterKey === null) {
            throw createError('KEYMKM-NOKEYENC');
        }

        return symmetricEncryptAndEmbedNonce(data, this.#masterKey);
    }

    /**
     * Decrypt data with the master key.
     *
     * Only works if the master key was previously set.
     *
     * @param {Uint8Array | ArrayBufferLike} cypherAndNonce - The data to decrypt
     * @returns {Uint8Array}
     */
    public decryptDataWithMasterKey(cypherAndNonce: Uint8Array | ArrayBufferLike): Uint8Array {
        if (this.#masterKey === null) {
            throw createError('KEYMKM-NOKEYDEC');
        }

        return symmetricDecryptWithEmbeddedNonce(cypherAndNonce, this.#masterKey);
    }

    // ######## private section ########

    private static async writeAndEncodeMasterKey(
        secret: string,
        masterKey: SymmetricKey,
        masterKeyFileName: string,
        saltFileName: string
    ): Promise<void> {
        const salt = await MasterKeyManager.createSaltFile(saltFileName);
        const derivedKey = await deriveSymmetricKeyFromSecret(secret, salt);
        const masterKeyEncrypted = symmetricEncryptAndEmbedNonce(masterKey, derivedKey);
        await deleteFile(masterKeyFileName, STORAGE.PRIVATE);
        await writePrivateBinaryRaw(masterKeyFileName, masterKeyEncrypted.buffer);
    }

    private static async loadAndDecodeMasterKey(
        secret: string,
        masterKeyFileName: string,
        saltFileName: string
    ): Promise<SymmetricKey> {
        const salt = await MasterKeyManager.loadSaltFile(saltFileName);
        const derivedKey = await deriveSymmetricKeyFromSecret(secret, salt);
        const masterKeyEncrypted = new Uint8Array(await readPrivateBinaryRaw(masterKeyFileName));
        return ensureSymmetricKey(
            symmetricDecryptWithEmbeddedNonce(masterKeyEncrypted, derivedKey)
        );
    }

    private static async createSaltFile(saltFileName: string): Promise<Salt> {
        const salt = createRandomSalt();
        await deleteFile(saltFileName, STORAGE.PRIVATE);
        await writePrivateBinaryRaw(saltFileName, salt.buffer);
        return salt;
    }

    private static async loadSaltFile(saltFileName: string): Promise<Salt> {
        const salt = new Uint8Array(await readPrivateBinaryRaw(saltFileName));
        return ensureSalt(salt);
    }
}
