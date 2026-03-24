import {postJson} from '@refinio/one.core/lib/system/post-json.js';
import {SettingsStore} from '@refinio/one.core/lib/system/settings-store.js';
import {
    ensureHexString,
    hexToUint8Array
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';

import {
    createRecoveryInformation,
    isBundledEncryptedRecoveryInformation,
    recoverSecret,
    recoverSecretAsString
} from './PasswordRecovery.js';
import type {Identity} from '../IdentityExchange.js';

export default class PasswordRecoveryClient {
    private readonly identity: Identity;

    constructor(recoveryServerIdentity: Identity) {
        this.identity = recoveryServerIdentity;
    }

    /**
     * Create the recovery information and store them in local storage until needed.
     *
     * @param secret - The secret that should be later recovered. Limited to 1023 bytes.
     * @param identity - The identity that is needed by the recovery service to identify you.
     * Limited to approx 980 bytes.
     */
    async createAndStoreRecoveryInformation(secret: string | Uint8Array, identity: string) {
        const info = createRecoveryInformation(
            hexToUint8Array(this.identity.instanceKeyPublic),
            secret,
            identity
        );
        await SettingsStore.setItem('SecretRecoveryService.encryptedSecret', info.encryptedSecret);
        await SettingsStore.setItem(
            'SecretRecoveryService.bundledEncryptedRecoveryInformation',
            info.bundledEncryptedRecoveryInformation
        );
    }

    /**
     * Send recovery information to server.
     *
     * The recovery service will contact you by some means (snail mail, mail or you have to
     * phyically go somewhere to get the symmetric key that they give you.)
     */
    async sendRecoveryInformationToServer(): Promise<void> {
        const bundledRecoveryInfo = await SettingsStore.getItem(
            'SecretRecoveryService.bundledEncryptedRecoveryInformation'
        );

        if (!isBundledEncryptedRecoveryInformation(bundledRecoveryInfo)) {
            throw new Error('Bundled recovery info that is stored in SettingsStore is invalid.');
        }

        await postJson(
            this.identity.url + '/passwordRecoveryRequests',
            JSON.stringify(bundledRecoveryInfo)
        );
    }

    /**
     * Recover your secret with the help of the symmetric key that you got from the recovery
     * service.
     *
     * @param symmetricKey
     */
    async recoverSecret(symmetricKey: string): Promise<Uint8Array> {
        const encryptedSecret = await SettingsStore.getItem(
            'SecretRecoveryService.encryptedSecret'
        );
        if (typeof encryptedSecret !== 'string') {
            throw new Error(
                'Settings Store "SecretRecoveryService.encryptedSecret" must be a string'
            );
        }

        return recoverSecret(ensureHexString(symmetricKey), ensureHexString(encryptedSecret));
    }

    /**
     * Recover your secret with the help of the symmetric key that you got from the recovery
     * service.
     *
     * @param symmetricKey
     */
    async recoverSecretAsString(symmetricKey: string): Promise<string> {
        const encryptedSecret = await SettingsStore.getItem(
            'SecretRecoveryService.encryptedSecret'
        );
        if (typeof encryptedSecret !== 'string') {
            throw new Error(
                'Settings Store "SecretRecoveryService.encryptedSecret" must be a string'
            );
        }

        return recoverSecretAsString(
            ensureHexString(encryptedSecret),
            ensureHexString(symmetricKey)
        );
    }
}
