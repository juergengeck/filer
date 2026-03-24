import {toByteArray} from 'base64-js';

import {
    closeAndDeleteCurrentInstance,
    deleteInstance,
    initInstance,
    instanceExists
} from '@refinio/one.core/lib/instance.js';
import {
    ensurePublicKey,
    ensureSecretKey,
    type KeyPair
} from '@refinio/one.core/lib/crypto/encryption.js';
import {
    ensurePublicSignKey,
    ensureSecretSignKey,
    type SignKeyPair
} from '@refinio/one.core/lib/crypto/sign.js';

import Authenticator from './Authenticator.js';

/**
 * This class represents an 'Multi User API With Credentials' authentication workflow.
 */
export default class MultiUser extends Authenticator {
    /**
     * Registers the user. Register acts as a login if the instance does not exist yet.
     * @param email
     * @param secret
     * @param instanceName
     * @param secretEncryptionKey
     * @param secretSignKey
     * @param registerData
     */
    async register(
        email: string,
        secret: string,
        instanceName: string,
        secretEncryptionKey?: Uint8Array | string,
        secretSignKey?: Uint8Array | string
    ): Promise<void> {
        this.authState.triggerEvent('login');

        if (await instanceExists(instanceName, email)) {
            this.authState.triggerEvent('login_failure');
            throw new Error('Could not register user. User already exists.');
        }

        try {
            let personEncryptionKeyPair: KeyPair | undefined = undefined;
            let personSignKeyPair: SignKeyPair | undefined = undefined;

            if (secretEncryptionKey) {
                const secretEncryptionKeyUint8Array =
                    typeof secretEncryptionKey === 'string'
                        ? toByteArray(secretEncryptionKey)
                        : secretEncryptionKey;
                personEncryptionKeyPair = {
                    secretKey: ensureSecretKey(secretEncryptionKeyUint8Array),
                    publicKey: ensurePublicKey(secretEncryptionKeyUint8Array)
                };
            }

            if (secretSignKey) {
                const secretSignKeyUint8Array =
                    typeof secretSignKey === 'string' ? toByteArray(secretSignKey) : secretSignKey;
                personSignKeyPair = {
                    secretKey: ensureSecretSignKey(secretSignKeyUint8Array),
                    publicKey: ensurePublicSignKey(secretSignKeyUint8Array)
                };
            }

            await initInstance({
                name: instanceName,
                email: email,
                secret: secret,
                ownerName: email,
                directory: this.config.directory,
                initialRecipes: this.config.recipes,
                initiallyEnabledReverseMapTypes: this.config.reverseMaps,
                initiallyEnabledReverseMapTypesForIdObjects: this.config.reverseMapsForIdObjects,
                storageInitTimeout: this.config.storageInitTimeout,
                personSignKeyPair,
                personEncryptionKeyPair
            });
        } catch (error) {
            this.authState.triggerEvent('login_failure');
            throw new Error(`Error while trying to initialise instance due to ${error}`);
        }

        try {
            await this.onLogin.emitAll(instanceName, secret, email);
            this.authState.triggerEvent('login_success');
        } catch (error) {
            await closeAndDeleteCurrentInstance();
            this.authState.triggerEvent('login_failure');
            throw new Error(`Error while trying to configure instance due to ${error}`);
        }
    }

    /**
     * Logins the user. This function will:
     *  - trigger the 'login' event
     *  - will check if the instance exists
     *      - if yes, it will initialize the instance, import modules, register recipes,
     *        trigger onLogin and wait for all the listeners to finish and trigger
     *        'login_success' event
     *      - if no, it will trigger 'login_failure' event
     * @param email
     * @param secret
     * @param instanceName
     */
    async login(email: string, secret: string, instanceName: string): Promise<void> {
        this.authState.triggerEvent('login');

        if (!(await instanceExists(instanceName, email))) {
            this.authState.triggerEvent('login_failure');
            throw new Error('Error while trying to login. User does not exist.');
        }

        try {
            await initInstance({
                name: instanceName,
                email: email,
                secret: secret,
                ownerName: email,
                directory: this.config.directory,
                initialRecipes: this.config.recipes,
                initiallyEnabledReverseMapTypes: this.config.reverseMaps,
                initiallyEnabledReverseMapTypesForIdObjects: this.config.reverseMapsForIdObjects,
                storageInitTimeout: this.config.storageInitTimeout
            });
        } catch (error) {
            this.authState.triggerEvent('login_failure');

            if (error.code === 'IC-AUTH') {
                throw new Error('The provided secret is wrong');
            }
            throw new Error(`Error while trying to initialise instance due to ${error}`);
        }

        try {
            await this.onLogin.emitAll(instanceName, secret, email);
            this.authState.triggerEvent('login_success');
        } catch (error) {
            this.authState.triggerEvent('login_failure');
            throw new Error(`Error while trying to configure instance due to ${error}`);
        }
    }

    /**
     * This function will login or register based on the instance existence.
     * @param email
     * @param secret
     * @param instanceName
     */
    async loginOrRegister(email: string, secret: string, instanceName: string): Promise<void> {
        if (await instanceExists(instanceName, email)) {
            await this.login(email, secret, instanceName);
        } else {
            await this.register(email, secret, instanceName);
        }
    }

    /**
     * Checks if the user exists or not.
     * @param email
     * @param instanceName
     */
    async isRegistered(email: string, instanceName: string): Promise<boolean> {
        return await instanceExists(instanceName, email);
    }

    /**
     * Erases the instance. This function will:
     *  - deletes the instance
     */
    async erase(instanceName: string, email: string): Promise<void> {
        await deleteInstance(instanceName, email);
    }

    /**
     * Erases the current instance. This function will:
     *  - trigger the 'logout' & onLogout events
     *  - delete the instance
     *  - trigger 'logout_done' event
     */
    async logoutAndErase(): Promise<void> {
        this.authState.triggerEvent('logout');

        // Signal the application that it should shutdown one dependent models
        // and wait for them to shut down
        await this.onLogout.emitAll();

        await closeAndDeleteCurrentInstance();
        this.authState.triggerEvent('logout_done');
    }
}
