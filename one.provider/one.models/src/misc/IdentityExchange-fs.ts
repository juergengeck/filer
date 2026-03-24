/**
 * This file implements helper functions to generate and import / export identities from / to the file system.
 * @module
 */

import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import {readdir, readFile, writeFile} from 'fs/promises';
import type {OneInstanceEndpoint} from '../recipes/Leute/CommunicationEndpoints.js';
import type {Identity, IdentityWithSecrets} from './IdentityExchange.js';
import {
    convertIdentityToOneInstanceEndpoint,
    convertIdentityToProfile,
    convertOneInstanceEndpointToIdentity,
    generateNewIdentity,
    isIdentity,
    isIdentityWithSecrets
} from './IdentityExchange.js';
import type ProfileModel from '../models/Leute/ProfileModel.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';

// ######## Identity I/O ########

/**
 * Creates a random identity and writes it to a file.
 *
 * Does not need a running one instance.
 *
 * @param fileNamePrefix - The prefix of the file. ${fileNamePrefix}_secret.id.json is the identity with secret keys,
 *                         ${fileNamePrefix}.id.json is the identity only with public keys.
 * @param url - The communication server url to include in the identity file.
 * @param personEmail - The person email to use. If not specified a random string is used.
 * @param instanceName - The instance name to use. If not specified a random string is used.
 */
export async function writeNewIdentityToFile(
    fileNamePrefix: string,
    url?: string,
    personEmail?: string,
    instanceName?: string
): Promise<{
    secret: IdentityWithSecrets;
    public: Identity;
    secretFileName: string;
    publicFileName: string;
}> {
    const identity = await generateNewIdentity(url, personEmail, instanceName);
    const secretFileName = fileNamePrefix + '_secret.id.json';
    const publicFileName = fileNamePrefix + '.id.json';
    await writeIdentityWithSecretsFile(secretFileName, identity.secret);
    await writeIdentityFile(publicFileName, identity.public);

    return {
        secret: identity.secret,
        public: identity.public,
        secretFileName,
        publicFileName
    };
}

/**
 * Write identity to a file.
 *
 * @param fileName
 * @param identity
 */
export async function writeIdentityFile(fileName: string, identity: Identity): Promise<void> {
    await writeFile(fileName, JSON.stringify(identity, null, 4), {encoding: 'utf8'});
}

/**
 * Write identity that includes secrets to a file.
 *
 * @param fileName
 * @param identity
 */
export async function writeIdentityWithSecretsFile(
    fileName: string,
    identity: IdentityWithSecrets
) {
    await writeFile(fileName, JSON.stringify(identity, null, 4), {encoding: 'utf8'});
}

/**
 * Read identity from a file.
 *
 * @param fileName
 */
export async function readIdentityFile(fileName: string): Promise<Identity> {
    const data = JSON.parse(await readFile(fileName, {encoding: 'utf8'}));

    if (!isIdentity(data)) {
        throw new Error('Format of identity file with secrets is wrong.');
    }

    return data;
}

/**
 * Read identity that includes secrets from a file.
 *
 * @param fileName
 */
export async function readIdentityWithSecretsFile(fileName: string): Promise<IdentityWithSecrets> {
    const data = JSON.parse(await readFile(fileName, {encoding: 'utf8'}));

    if (!isIdentityWithSecrets(data)) {
        throw new Error('Format of identity file with secrets is wrong.');
    }

    return data;
}

/**
 * Read an identity from the specified file or create a new one if the file does not exist.
 *
 * If and identity file does not exist it will create a file with a random identity.
 * Prerequisite is, that the filename ends in '_secret.id.json'
 *
 * If you set filename to abc_secret.id.json then this will generate the following files:
 * - abc_secret.id.json
 * - abc.id.json
 *
 * @param fileName - The file rom which to read / to which to write the identity to.
 * @param url - url to include in the randomly generated identity.
 * @param personEmail - The person email to use when a new identity is created. If not specified a
 *                      random string is used.
 * @param instanceName - The instance name to use when a new identity is created. If not specified a
 *                       random string is used.
 */
export async function readOrCreateIdentityWithSecretsFile(
    fileName: string,
    url?: string,
    personEmail?: string,
    instanceName?: string
): Promise<IdentityWithSecrets> {
    if (!fileName.endsWith('_secret.id.json')) {
        throw new Error(
            'If you want to generate an identity, the secret identity filename needs to end with' +
                ' _secret.id.json'
        );
    }

    let identity: IdentityWithSecrets;
    try {
        identity = await readIdentityWithSecretsFile(fileName);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
        const id = await writeNewIdentityToFile(
            fileName.slice(0, -'_secret.id.json'.length),
            url,
            personEmail,
            instanceName
        );
        identity = id.secret;
    }
    return identity;
}

/**
 * Read an identity from the specified file or create a new one if the file does not exist.
 *
 * If and identity file does not exist it will create a file with a random identity.
 * In contrast to readIdentityWithSecretsFileOrWriteRandom this will only generate a public
 * identity file and not the secret one.
 * This means that the secret information is only kept in memory, while the public information
 * is written.
 *
 * @param fileName - The file rom which to read / to which to write the identity to.
 * @param url - commserver to include in the randomly generated identity.
 * @param personEmail - The person email to use when a new identity is created. If not specified a
 *                      random string is used.
 * @param instanceName - The instance name to use when a new identity is created. If not specified a
 *                       random string is used.
 * @returns If an identity file exists, it will return an Identity, otherwise it will return an
 * IdentityWithSecrets.
 */
export async function readOrCreateIdentityFile(
    fileName: string,
    url?: string,
    personEmail?: string,
    instanceName?: string
): Promise<Identity | IdentityWithSecrets> {
    try {
        return await readIdentityFile(fileName);
    } catch (_) {
        const identity = await generateNewIdentity(url, personEmail, instanceName);
        await writeIdentityFile(fileName, identity.public);
        return identity.secret;
    }
}

// ######## Identity I/O using one objects ########

/**
 * Import an identity as OneInstanceEndpoint.
 *
 * This also signs the keys with our own key, so that they are considered trusted keys.
 *
 * @param fileName
 */
export async function importIdentityFileAsOneInstanceEndpoint(
    fileName: string
): Promise<UnversionedObjectResult<OneInstanceEndpoint>> {
    const identity = await readIdentityFile(fileName);
    return convertIdentityToOneInstanceEndpoint(identity);
}

/**
 * Export an OneInstanceEndpoint as Identity file.
 *
 * @param fileName
 * @param oneInstanceEndpoint
 */
export async function exportOneInstanceEndpointAsIdentityFile(
    fileName: string,
    oneInstanceEndpoint: SHA256Hash<OneInstanceEndpoint>
): Promise<void> {
    const identity = await convertOneInstanceEndpointToIdentity(oneInstanceEndpoint);
    return writeIdentityFile(fileName, identity);
}

/**
 * Imports all identity files in specified directory as profiles.
 *
 * Note: If the Leute model is initialized, then those profiles will be registered at leute via the
 *       leute hook.
 *
 * @param excludeFile - Name of file to exclude (usually my own identity)
 * @param directory - The directory to search for id.json files.
 */
export async function importIdentityFilesAsProfiles(
    excludeFile: string,
    directory = '.'
): Promise<ProfileModel[]> {
    const filter = '.id.json';
    const files = await readdir(directory);
    const identityFiles = files
        .filter(file => file.endsWith(filter))
        .filter(file => !file.includes(excludeFile) && !file.includes('_secret'));

    return await Promise.all(
        identityFiles.map(async file => {
            const identityFileContent = await readFile(file, {encoding: 'utf-8'});
            return convertIdentityToProfile(JSON.parse(identityFileContent));
        })
    );
}
