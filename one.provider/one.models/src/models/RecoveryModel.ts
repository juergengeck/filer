import {deriveBinaryKey} from '@refinio/one.core/lib/system/crypto-scrypt.js';
import tweetnacl from 'tweetnacl';
import type {PrivatePersonInformationMessage} from '../misc/ConnectionEstablishment/protocols/CommunicationInitiationProtocolMessages.js';
import type ConnectionsModel from './ConnectionsModel.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {randomBytes} from 'crypto';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {Model} from './Model.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {
    hexToUint8Array,
    uint8arrayToHexString
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {
    createRandomSalt,
    deriveSymmetricKeyFromSecret,
    ensureSalt,
    symmetricDecryptWithEmbeddedNonce,
    symmetricEncryptAndEmbedNonce
} from '@refinio/one.core/lib/crypto/encryption.js';
import {getIdObject} from '@refinio/one.core/lib/storage-versioned-objects.js';

/**
 * For the recovery process the person email with the corresponding
 * person keys and the anonymous person email with the corresponding
 * person keys have to be encrypted and added to the recovery url in
 * order to have the same persons also after recovering the instance.
 */
interface PersonInformation {
    personEmail: string;
    personPublicKey: HexString;
    personPublicSignKey: HexString;
    personPrivateKey: HexString;
    personPrivateSignKey: HexString;
}

/**
 * This model is responsible for generating the information which will
 * be added in the recovery url and for extracting the data from the
 * recovery url.
 *
 * This does not work at the moment, because we cant read / write private keys because the
 * key-management changed.
 */
export default class RecoveryModel extends Model {
    private readonly recoveryKeyLength: number;
    private connectionsModel: ConnectionsModel;
    private decryptedObject: PersonInformation | undefined;
    private password: string;

    constructor(connectionsModel: ConnectionsModel) {
        super();
        // default length for the recovery key
        this.recoveryKeyLength = 19;
        this.connectionsModel = connectionsModel;
        this.password = '';

        this.state.assertCurrentState('Uninitialised');
        this.state.triggerEvent('init');
    }

    /**
     * The password needs to be memorised for encrypting and decrypting private person keys.
     *
     * This will be deleted after the recovery file is created or if the model was
     * initialised for the recovery process.
     *
     * TODO: remove me and ask the user instead. Long term storage is a bad idea!
     *
     * @param password
     */
    public setPassword(password: string) {
        this.state.assertCurrentState('Initialised');

        this.password = password;
    }

    async shutdown(): Promise<void> {
        this.state.triggerEvent('shutdown');
    }

    /**
     * Extract all person information and encrypt them using the
     * recovery nonce and recovery key.
     *
     * The person private keys are decrypted before creating the
     * person information object.
     *
     * @returns
     */
    async extractEncryptedPersonInformation(): Promise<{
        recoveryKey: string;
        recoveryNonce: string;
        encryptedPersonInformation: string;
    }> {
        this.state.assertCurrentState('Initialised');

        if (this.password === '') {
            throw new Error(
                'Can not generate recovery file without knowing the instance password!'
            );
        }

        // generate a new nonce which will be used in encrypting the person information
        const recoveryNonce = createRandomSalt(64);

        // generate a new key which will be used together with
        // the nonce for encrypting the person information
        const recoveryKey = this.generateRandomReadableString();
        const derivedKey = await deriveSymmetricKeyFromSecret(recoveryKey, recoveryNonce);

        // extract all information for main person and anonymous
        // person that will be encrypted and added in the url
        const objectToEncrypt = await this.extractPersonInformation();

        // encrypt the persons information with the recovery nonce and recovery key
        const encryptedPersonInformation = uint8arrayToHexString(
            symmetricEncryptAndEmbedNonce(
                new TextEncoder().encode(JSON.stringify(objectToEncrypt)),
                derivedKey
            )
        );

        return {
            recoveryKey: recoveryKey,
            recoveryNonce: uint8arrayToHexString(recoveryNonce),
            encryptedPersonInformation: encryptedPersonInformation
        };
    }

    /**
     * This is the first step in the recovery process.
     *
     * When the recovery process is started the first values that are required
     * are the person email and the anonymous person email.
     *
     * Using the encrypted recovery information and the recovery nonce from the
     * url and the recovery key which was entered by the user this function
     * decrypts the person information and returns the user email and the
     * anonymous person email.
     *
     * The decrypted data will be saved in memory until the next step in the
     * recovery process (overwritePersonKeyWithReceivedEncryptedOnes function).
     *
     * @param recoveryKey
     * @param recoveryNonce
     * @param encryptedPersonInformation
     * @returns
     */
    async decryptReceivedRecoveryInformation(
        recoveryKey: string,
        recoveryNonce: HexString,
        encryptedPersonInformation: HexString
    ): Promise<string> {
        this.state.assertCurrentState('Initialised');

        const objectToDecrypt = hexToUint8Array(encryptedPersonInformation);
        const derivedKey = await deriveSymmetricKeyFromSecret(
            recoveryKey,
            ensureSalt(hexToUint8Array(recoveryNonce))
        );
        this.decryptedObject = JSON.parse(
            new TextDecoder().decode(symmetricDecryptWithEmbeddedNonce(objectToDecrypt, derivedKey))
        );

        if (!this.decryptedObject) {
            throw new Error('Received recovery information could not be decrypted.');
        }

        return this.decryptedObject.personEmail;
    }

    /**
     * This is the second and last step in the recovery process.
     * Before calling this function the decryptReceivedRecoveryInformation
     * function should be called in order to decrypt the received data and
     * to memorise it for this step.
     *
     * In recovery process a new person is created with the received email, but
     * since the keys are different every time they are created, we need to overwrite
     * the new created person keys with the old ones because the person is the same
     * so the keys have to be the same also.
     *
     * The received person private keys are decrypted, so before memorising them
     * we first need to encrypt the received private keys with the new password.
     *
     * The password must be set before this function is called.
     */
    async overwritePersonKeyWithReceivedEncryptedOnes(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        if (!this.decryptedObject) {
            throw new Error('Received recovery information not found.');
        }

        const personId = await calculateIdHashOfObj({
            $type$: 'Person',
            email: this.decryptedObject.personEmail
        });

        // overwrite person keys with the old ones
        // for private keys we first need to encrypt them with the new password
        const privatePersonInformation: PrivatePersonInformationMessage = {
            command: 'private_person_information',
            personId,
            personPublicKey: this.decryptedObject.personPublicKey,
            personPublicSignKey: this.decryptedObject.personPublicSignKey,
            personPrivateKey: await this.encryptPersonPrivateKey(
                this.decryptedObject.personPrivateKey
            ),
            personPrivateSignKey: await this.encryptPersonPrivateKey(
                this.decryptedObject.personPrivateSignKey
            )
        };
        await RecoveryModel.overwriteExistingPersonKeys(privatePersonInformation);

        // remove from memory the decrypted person information because it's not important anymore
        this.decryptedObject = undefined;
    }

    // ######## Private API ########

    /**
     * For the recovery key we need a simple string random generator which will return
     * a user friendly string, which will be easy to read for the user.
     *
     * A user friendly string or a readable string can not contain o, O and 0, I and l.
     *
     * @returns
     * @private
     */
    private generateRandomReadableString(): string {
        const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz.-_=!';
        let randomstring = '';
        for (let i = 0; i < this.recoveryKeyLength; i++) {
            const randomNumber = Math.floor(Math.random() * chars.length);
            randomstring += chars.substring(randomNumber, randomNumber + 1);
        }
        return randomstring;
    }

    /**
     * For extracting the persons information the extractExistingPersonKeys function
     * from ConnectionsModel is used.
     *
     * The private keys are decrypted before being added to the person information
     * object.
     *
     * @returns
     * @private
     */
    private async extractPersonInformation(): Promise<PersonInformation> {
        // extract main person and anonymous person public and encrypted private keys
        const privatePersonInformation = {} as PrivatePersonInformationMessage; // Attention,
        // this was faked, because no method will give us private keys at the moment! You eed to
        // fix this in order to get the recovery model working again.
        // extract main person public keys
        const personPublicKey = privatePersonInformation.personPublicKey;
        const personPublicSignKey = privatePersonInformation.personPublicSignKey;
        // decrypt main person private keys
        const personPrivateKeys = await RecoveryModel.extractDecryptedPrivateKeysForPerson(
            privatePersonInformation.personId
        );
        const personPrivateKey = personPrivateKeys.privateKey;
        const personPrivateSignKey = personPrivateKeys.privateSignKey;
        // extract the main person email
        const person = await getIdObject(privatePersonInformation.personId);
        const personEmail = person.email;

        // create the person information object which will be encrypted and added in the url
        return {
            personEmail: personEmail,
            personPublicKey: personPublicKey,
            personPublicSignKey: personPublicSignKey,
            personPrivateKey: personPrivateKey,
            personPrivateSignKey: personPrivateSignKey
        };
    }

    /**
     * Decrypt the private keys for the person received as parameter.
     *
     * The password must be set before this function is called.
     *
     * @param _personId
     * @returns
     * @private
     */
    private static async extractDecryptedPrivateKeysForPerson(
        _personId: SHA256IdHash<Person>
    ): Promise<{
        privateKey: HexString;
        privateSignKey: HexString;
    }> {
        throw new Error(
            'Retrieving secret keys was disabled, because the keymanagement changed.' +
                ' If this is needed again, then implement it again after thinking of the' +
                ' consequences!'
        );

        /*return {
            privateKey: uint8arrayToHexString(personPrivateEncryptionKey),
            privateSignKey: uint8arrayToHexString(personPrivateSignKey)
        };*/
    }

    /**
     * Change the private keys of the person.
     *
     * @param _personInfo
     * @private
     */
    private static async overwriteExistingPersonKeys(
        _personInfo: PrivatePersonInformationMessage
    ): Promise<void> {
        throw new Error(
            'Overwriting secret keys was disabled, because the keymanagement changed.' +
                ' If this is needed again, then implement it again after thinking of the' +
                ' consequences!'
        );
    }

    /**
     * Encrypt the private key received as parameter using the
     * password from memory.
     *
     * The private keys will be memorised in the ConnectionsModel
     * overwriteExistingPersonKeys function.
     *
     * The password must be set before this function is called.
     *
     * @param keyAsString
     * @returns
     * @private
     */
    private async encryptPersonPrivateKey(keyAsString: HexString): Promise<HexString> {
        const key = hexToUint8Array(keyAsString);
        const nonce = randomBytes(tweetnacl.secretbox.nonceLength);
        const derivedKey = await deriveBinaryKey(
            this.password,
            nonce,
            tweetnacl.secretbox.keyLength
        );
        const encrypted = tweetnacl.secretbox(key, nonce, derivedKey);
        const encryptedKey = new Uint8Array(tweetnacl.secretbox.nonceLength + encrypted.byteLength);
        encryptedKey.set(nonce, 0);
        encryptedKey.set(encrypted, nonce.byteLength);
        return uint8arrayToHexString(encryptedKey);
    }
}
