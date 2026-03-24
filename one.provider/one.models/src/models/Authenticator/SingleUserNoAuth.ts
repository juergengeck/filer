import nacl from 'tweetnacl';
import {toByteArray} from 'base64-js';

import {ensurePublicKey, ensureSecretKey} from '@refinio/one.core/lib/crypto/encryption.js';
import {
    closeAndDeleteCurrentInstance,
    initInstance,
    instanceExists
} from '@refinio/one.core/lib/instance.js';
import {createRandomString} from '@refinio/one.core/lib/system/crypto-helpers.js';
import {ensurePublicSignKey, ensureSecretSignKey} from '@refinio/one.core/lib/crypto/sign.js';

import Authenticator from './Authenticator.js';

type Credentials = {
    email: string;
    instanceName: string;
    secret: string;
};

/**
 * This class represents an 'Single User API without Credentials' authentication workflow.
 */
export default class SingleUserNoAuth extends Authenticator {
    /**
     * The store key to the credentials container for SingleUserNoAuth
     * @private
     */
    private static readonly CREDENTIAL_CONTAINER_KEY_STORE = 'credentials-single-user-no-auth';

    /**
     * Registers the user with generated credentials.
     * This function will:
     *  - will check if there are any stored credentials
     *      - if no, it will persist the generated email, instance name & secret
     *      - if yes, continue
     *  - will trigger the 'login' event
     *  - will init the instance
     *  - if successful
     *      - if yes, it will trigger the 'login_success' event
     *      - if no, it will throw error and trigger 'login_failure' event
     */
    async register(registerData?: {
        email?: string;
        instanceName?: string;
        secret?: string;
    }): Promise<void> {
        this.authState.triggerEvent('login');

        const {instanceName, email, secret} = registerData
            ? await this.generateCredentialsWithDataIfNotExist(registerData)
            : await this.generateCredentialsIfNotExist();

        if (await instanceExists(instanceName, email)) {
            this.authState.triggerEvent('login_failure');
            throw new Error('Could not register user. The single user already exists.');
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
            await this.store.removeItem(SingleUserNoAuth.CREDENTIAL_CONTAINER_KEY_STORE);
            this.authState.triggerEvent('login_failure');
            throw new Error(`Error while trying to initialise instance due to ${error}`);
        }

        try {
            await this.onLogin.emitAll(instanceName, secret, email);
            this.authState.triggerEvent('login_success');
        } catch (error) {
            await closeAndDeleteCurrentInstance();
            await this.store.removeItem(SingleUserNoAuth.CREDENTIAL_CONTAINER_KEY_STORE);
            this.authState.triggerEvent('login_failure');
            throw new Error(`Error while trying to configure instance due to ${error}`);
        }
    }

    /**
     * @param secretEncryptionKey
     * @param secretSignKey
     * @param registerData
     */
    async registerWithKeys(
        secretEncryptionKey: Uint8Array | string,
        secretSignKey: Uint8Array | string,
        registerData?: {
            email?: string;
            instanceName?: string;
            secret?: string;
        }
    ): Promise<void> {
        this.authState.triggerEvent('login');

        const {instanceName, email, secret} = registerData
            ? await this.generateCredentialsWithDataIfNotExist(registerData)
            : await this.generateCredentialsIfNotExist();

        if (await instanceExists(instanceName, email)) {
            this.authState.triggerEvent('login_failure');
            throw new Error('Could not register user. The single user already exists.');
        }

        try {
            const secretEncryptionKeyUint8Array =
                typeof secretEncryptionKey === 'string'
                    ? toByteArray(secretEncryptionKey)
                    : secretEncryptionKey;
            const publicEncryptionKeyUint8Array = nacl.box.keyPair.fromSecretKey(
                secretEncryptionKeyUint8Array
            ).publicKey;

            const secretSignKeyUint8Array =
                typeof secretSignKey === 'string' ? toByteArray(secretSignKey) : secretSignKey;
            const publicSignKeyUint8Array =
                nacl.sign.keyPair.fromSecretKey(secretSignKeyUint8Array).publicKey;

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
                personEncryptionKeyPair: {
                    publicKey: ensurePublicKey(publicEncryptionKeyUint8Array),
                    secretKey: ensureSecretKey(secretEncryptionKeyUint8Array)
                },
                personSignKeyPair: {
                    publicKey: ensurePublicSignKey(publicSignKeyUint8Array),
                    secretKey: ensureSecretSignKey(secretSignKeyUint8Array)
                }
            });
        } catch (error) {
            await this.store.removeItem(SingleUserNoAuth.CREDENTIAL_CONTAINER_KEY_STORE);
            this.authState.triggerEvent('login_failure');
            throw new Error(`Error while trying to initialise instance due to ${error}`);
        }

        try {
            await this.onLogin.emitAll(instanceName, secret, email);
            this.authState.triggerEvent('login_success');
        } catch (error) {
            await closeAndDeleteCurrentInstance();
            await this.store.removeItem(SingleUserNoAuth.CREDENTIAL_CONTAINER_KEY_STORE);
            this.authState.triggerEvent('login_failure');
            throw new Error(`Error while trying to configure instance due to ${error}`);
        }
    }

    /**
     * Logins the user. This function will:
     *  - trigger the 'login' event
     *  - will check if there are any stored credentials
     *      - if no, it will throw an error and trigger 'login_failure' event
     *      - if yes, it will check if the instance exist
     *          - if no, it will throw an error and trigger 'login_failure' event
     *          - if yes, it will initialize the instance, import modules, register recipes
     *            trigger onLogin and wait for all the listeners to finish and trigger
     *            'login_success' event
     */
    async login(): Promise<void> {
        this.authState.triggerEvent('login');

        const credentials = await this.retrieveCredentialsFromStore();

        if (credentials === undefined) {
            this.authState.triggerEvent('login_failure');
            throw new Error('Error while trying to login. User was not registered.');
        }

        const {email, instanceName, secret} = credentials;

        if (!(await instanceExists(instanceName, email))) {
            this.authState.triggerEvent('login_failure');
            throw new Error('Error while trying to login. User instance does not exist.');
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
                throw new Error(
                    'The stored secret is malformed, unrecovarable error. Delete instance.'
                );
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
     * This function will login or register based on the credentials existence in store.
     */
    async loginOrRegister(): Promise<void> {
        const isRegistered = await this.isRegistered();

        if (isRegistered) {
            await this.login();
        } else {
            await this.register();
        }
    }

    /**
     * Checks if the user exists or not by checking the credentials in the store.
     */
    async isRegistered(): Promise<boolean> {
        // check if there are any saved credentials
        const credentials = await this.retrieveCredentialsFromStore();

        if (credentials === undefined) {
            return false;
        }
        const {email, instanceName} = credentials;

        return await instanceExists(instanceName, email);
    }

    /**
     * Erases the instance. This function will:
     *  - delete the instance
     *  - remove (if present) only workflow related store
     */
    async erase(): Promise<void> {
        const credentials = await this.retrieveCredentialsFromStore();
        if (credentials !== undefined) {
            await closeAndDeleteCurrentInstance();
            await this.store.removeItem(SingleUserNoAuth.CREDENTIAL_CONTAINER_KEY_STORE);
        } else {
            throw new Error(
                'Could not erase due to lack of credentials without loging in.' +
                    ' The credentials does not exist. Try to login and delete.'
            );
        }
    }

    /**
     * Erases the current instance. This function will:
     *  - trigger the 'logout' & onLogout events
     *  - remove (if present) only workflow related store
     *  - delete the instance
     *  - trigger 'logout_done' event
     */
    async logoutAndErase(): Promise<void> {
        this.authState.triggerEvent('logout');

        // Signal the application that it should shutdown one dependent models
        // and wait for them to shut down
        await this.onLogout.emitAll();

        await this.store.removeItem(SingleUserNoAuth.CREDENTIAL_CONTAINER_KEY_STORE);
        await closeAndDeleteCurrentInstance();
        this.authState.triggerEvent('logout_done');
    }

    private async retrieveCredentialsFromStore(): Promise<Credentials | undefined> {
        const storeCredentials = await this.store.getItem(
            SingleUserNoAuth.CREDENTIAL_CONTAINER_KEY_STORE
        );
        if (storeCredentials === undefined) {
            return undefined;
        }

        // Type cast: storing and retrieving is local to this module and we use the same key
        return storeCredentials as Credentials;
    }

    private async persistCredentialsToStore(credentials: Credentials): Promise<void> {
        await this.store.setItem(SingleUserNoAuth.CREDENTIAL_CONTAINER_KEY_STORE, credentials);
    }

    private async generateCredentialsIfNotExist(): Promise<Credentials> {
        const credentialsFromStore = await this.retrieveCredentialsFromStore();
        if (credentialsFromStore === undefined) {
            const generatedCredentials = {
                email: await createRandomString(64),
                instanceName: await createRandomString(64),
                secret: await createRandomString(64)
            };
            await this.persistCredentialsToStore(generatedCredentials);
            return generatedCredentials;
        }
        return credentialsFromStore;
    }

    private async generateCredentialsWithDataIfNotExist(data: {
        email?: string;
        instanceName?: string;
        secret?: string;
    }): Promise<Credentials> {
        const credentialsFromStore = await this.retrieveCredentialsFromStore();
        if (credentialsFromStore === undefined) {
            const generatedCredentials = {
                email: data.email ? data.email : await createRandomString(64),
                instanceName: data.instanceName ? data.instanceName : await createRandomString(64),
                secret: data.secret ? data.secret : await createRandomString(64)
            };
            await this.persistCredentialsToStore(generatedCredentials);
            return generatedCredentials;
        }
        return credentialsFromStore;
    }
}
