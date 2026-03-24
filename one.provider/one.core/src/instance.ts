/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module contains the function to initialize a ONE application instance.
 * @module
 */

/**
 * @global
 * @typedef {object} InstanceOptions
 * @property {string} name - A name given to the instance by the user
 * @property {string} email - The email address of the user owning this ONE application
 * instance
 * @property {string} secret - A secret used to authenticate the given email ID. The string will be
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize|normalized}.
 * @property {string} [ownerName] - The name of the owner (optional)
 * @property {KeyPair} [personEncryptionKeyPair] - Encryption keypair used for instance owner.
 * If provided, **all four keys** must be provided together. In that case no new keys will be
 * created upon instance creation, instead these keys will be used. The keys are only used for a
 * new instance. If they are provided but an instance already exists nothing will happen.
 * @property {SignKeyPair} [personSignKeyPair] - Sign keypair used for instance owner.
 * Also see the description for `personEncryptionKeyPair`.
 * @property {KeyPair} [instanceEncryptionKeyPair] - Encryption keypair used for instance.
 * Also see the description for `personEncryptionKeyPair`.
 * @property {SignKeyPair} [instanceSignKeyPair] - Sign keypair used for instance.
 * Also see the description for `personEncryptionKeyPair`.
 * @property {boolean} [wipeStorage] - If `true` **all files in storage will be deleted** when
 * the instance is initialized. All files means *every single file*. Storage is wiped clean.
 * @property {boolean} [encryptStorage] - On supporting platforms (browser) filenames and
 * file contents can be encrypted. `secret` must be a string and not `null`.
 * @property {string} [directory] - For filesystem based storage (node.js) the directory
 * where this ONE instances can store and read its objects. On browsers the name of the
 * IndexedDB database, if this is not set a default of "OneDB" is used. This option is
 * unused on mobile (react-native).
 * @property {number} [nHashCharsForSubDirs] - In "object" storage, the first `n` characters of o
 * files name - a hexadecimal SHA-256 hash string - are used to locate the file in a
 * subdirectory of that name. For example, if a file name (hash) starts with "0fe123...." and
 * n=2, then the file will be located not in directory `objects/` but in directory
 * `objects/0f/`. This hierarchical storage option is only offered on *some* platforms. When
 * this option has a number higher than 0 on a platform that does not support it an Error is
 * thrown.
 * @property {number} [storageInitTimeout] - The browser platform accepts this parameter to time
 * out the `indexedDB.open()` attempt in case the request blocks (found on Safari). Default is
 * 1000ms. This can or should be used together with `one.core/util/promise method` `retry`. On
 * other platforms this parameter is ignored.
 * @property {Recipe[]} [initialRecipes] - An optional array of {@link Recipe} ONE objects.
 * **This option is only used for initial Instance object creation.** If there is an existing
 * Instance it is simply ignored. You can use {@link registerRecipes} to add recipes to an
 * existing instance.
 * @property {Map<OneObjectTypeNames,null|Set<string>>} [initiallyEnabledReverseMapTypes] - A Map
 * object with ONE object type names as keys and an array of "itemprop" properties from the
 * recipe for that particular ONE object type for which reverse maps should be written. For all
 * other types and/or properties not mentioned in this Map reverse map entries are not created.
 * **This option is only used for initial Instance object creation.** If there is an existing
 * Instance it is simply ignored. **Right now this option cannot be changed after instance
 * creation.** This is a feature to be added later, when this is changed the whole storage has
 * to be iterated over to create any missing reverse maps if they are added later.
 * @property {Map<OneObjectTypeNamesForIdObjects,null|Set<string>>}
 * [initiallyEnabledReverseMapTypesForIdObjects] - A Map object with ONE object type names as
 * keys and an array of "itemprop" properties from the recipe for that particular ONE object
 * type for which ID object reverse maps should be written. For all other types and/or
 * properties not mentioned in this Map reverse map entries are not created. **This option is
 * only used for initial Instance object creation.** If there is an existing Instance it is
 * simply ignored. **Right now this option cannot be changed after instance creation.** This is
 * a feature to be added later, when this is changed the whole storage has to be iterated over
 * to create any missing reverse maps if they are added later.
 */
export interface InstanceOptions {
    name: string;
    email: string;
    secret: string;
    ownerName?: string;
    personEncryptionKeyPair?: KeyPair;
    personSignKeyPair?: SignKeyPair;
    instanceEncryptionKeyPair?: KeyPair;
    instanceSignKeyPair?: SignKeyPair;
    wipeStorage?: boolean;
    encryptStorage?: boolean;
    directory?: string;
    nHashCharsForSubDirs?: number;
    storageInitTimeout?: number;
    initialRecipes?: readonly Recipe[];
    initiallyEnabledReverseMapTypes?: Map<OneObjectTypeNames, Set<string>>;
    initiallyEnabledReverseMapTypesForIdObjects?: Map<OneVersionedObjectTypeNames, Set<string>>;
}

// NOOP TS-only import - that is a .d.ts file - so that when tsc checks declaration files in
// lib/ this file is included. It looks like it was not when running tsc with the top level
// tsconfig.json, which only checks scripts/*.js, but apparently it also checked lib even with
// the references to src/ and test/ removed and explicitly told (via "exclude") to ignore that
// folder. This line tells tsc to include this file so that there are no problems.
// import './@OneObjectInterfaces';

import type {KeyPair} from './crypto/encryption.js';
import type {SignKeyPair} from './crypto/sign.js';
import {createError} from './errors.js';
import {createInstance} from './instance-creator.js';
import {updateInstance} from './instance-updater.js';
import {lockKeyChain, unlockOrCreateKeyChain} from './keychain/keychain.js';
import {createMessageBus} from './message-bus.js';
import {
    addCoreRecipesToRuntime,
    addRecipeToRuntime,
    clearRuntimeRecipes,
    hasRecipe
} from './object-recipes.js';
import type {
    Instance,
    OneObjectTypeNames,
    OneVersionedObjectTypeNames,
    Person,
    Recipe
} from './recipes.js';
import {
    addEnabledRvMapType,
    addEnabledRvMapTypeForIdObjects,
    clearRvMapTypes
} from './reverse-map-updater.js';
import {getObjectWithType} from './storage-unversioned-objects.js';
import type {VersionedObjectResult} from './storage-versioned-objects.js';
import {getObjectByIdHash} from './storage-versioned-objects.js';
import {createCryptoHash} from './system/crypto-helpers.js';
import {closeStorage, deleteStorage, doesStorageExist, initStorage} from './system/storage-base.js';
import {ID_OBJECT_ATTR} from './util/object.js';
import {isString} from './util/type-checks-basic.js';
import type {SHA256IdHash} from './util/type-checks.js';

const MessageBus = createMessageBus('instance');

let InstanceDirectory: undefined | string;
let InstanceName: undefined | string;
let InstaceOwnerEmail: undefined | string;
let InstanceIdHash: undefined | SHA256IdHash<Instance>;
let InstanceOwnerIdHash: undefined | SHA256IdHash<Person>;

/**
 * @static
 * @returns {string|undefined} Returns instance directory
 */
export function getInstanceDirectory(): undefined | string {
    return InstanceDirectory;
}

/**
 * @static
 * @returns {string|undefined} Returns the `name`property of the {@link Instance} object of the
 * currently active instance, or `undefined` if the instance has not been initialized yet
 */
export function getInstanceName(): undefined | string {
    return InstanceName;
}

/**
 * @static
 * @returns {SHA256IdHash<Instance>|undefined} Returns the ID hash of the instance
 */
export function getInstanceIdHash(): undefined | SHA256IdHash<Instance> {
    return InstanceIdHash;
}

/**
 * @static
 * @returns {undefined | SHA256IdHash<Person>} Returns the ID hash of the instance owner person
 * object
 */
export function getInstanceOwnerIdHash(): undefined | SHA256IdHash<Person> {
    return InstanceOwnerIdHash;
}

/**
 * @static
 * @returns {string|undefined} Returns the instance owner email
 */
export function getInstanceOwnerEmail(): undefined | string {
    return InstaceOwnerEmail;
}

/**
 * Load the map files used by the app. If bootstrapping fails because the bootstrap objects
 * don't exist they are silently created.
 * @static
 * @async
 * @param {InstanceOptions} options - A mandatory object with options properties
 * @returns {Promise<Instance>} Returns the Instance object
 */
export async function initInstance({
    name,
    email,
    secret,
    ownerName,
    personEncryptionKeyPair,
    personSignKeyPair,
    instanceEncryptionKeyPair,
    instanceSignKeyPair,
    wipeStorage = false,
    encryptStorage = false,
    directory,
    nHashCharsForSubDirs = 0,
    storageInitTimeout = 1000,
    initialRecipes = [],
    initiallyEnabledReverseMapTypes,
    initiallyEnabledReverseMapTypesForIdObjects
}: InstanceOptions): Promise<Instance> {
    // Our architecture is set up so that one Javascript runtime environment can run one
    // instance. It is not possible to have two different ONE instances in the same Javascript
    // environment. Each instance has its own storage space identified by the Instance ID hash.
    if (InstanceName !== undefined) {
        throw createError('IN-INIT1', {iName: InstanceName});
    }

    if (encryptStorage && !isString(secret)) {
        throw createError('IN-INIT2', {iName: name});
    }

    MessageBus.send('log', `Initializing instance "${name}"`);

    // Catch-22: We need the Instance ID hash to initialize storage - but we cannot call the
    // Instance object creating instance-updater that would return that hash until after storage
    // has been initialized. To escape this contradiction we have to do the hash calculation
    // ourselves, even though the instance-updater will do the same later.
    // Trying to micro-optimize and to avoid doing the same work twice is not worth it though,
    // especially given that instance-updater doesn't do the calculation itself, but it happens
    // implicitly further down the call stack when it tries to load an already existing owner and
    // instance objects.
    const instanceIdHash = await calculateInstanceIdHash(name, email);

    await initStorage({
        instanceIdHash,
        wipeStorage,
        name: directory,
        nHashCharsForSubDirs,
        storageInitTimeout,
        encryptStorage,
        secretForStorageKey: secret
    });

    let instance: undefined | VersionedObjectResult<Instance>;

    // Add the CORE-Recipes. Needs to happen before any function using them is called.
    addCoreRecipesToRuntime();
    await unlockOrCreateKeyChain(secret);

    try {
        instance = await getObjectByIdHash(instanceIdHash);
    } catch (err) {
        if (err.name !== 'FileNotFoundError') {
            throw err;
        }

        instance = await createInstance({
            name,
            email,
            ownerName,
            personEncryptionKeyPair,
            personSignKeyPair,
            instanceEncryptionKeyPair,
            instanceSignKeyPair,
            initialRecipes,
            initiallyEnabledReverseMapTypes,
            initiallyEnabledReverseMapTypesForIdObjects
        });
    }

    const recipes = (
        await Promise.all([...instance.obj.recipe].map(hash => getObjectWithType(hash, 'Recipe')))
    ).filter(recipe => !hasRecipe(recipe.name));

    recipes.map(recipe => {
        return addRecipeToRuntime(recipe);
    });

    instance.obj.enabledReverseMapTypes.forEach((props, type) => addEnabledRvMapType(type, props));
    instance.obj.enabledReverseMapTypesForIdObjects.forEach((props, type) =>
        addEnabledRvMapTypeForIdObjects(type, props)
    );

    InstanceName = name;
    InstanceOwnerIdHash = instance.obj.owner;
    InstaceOwnerEmail = email;
    InstanceDirectory = directory;

    // Assign it to the module-level variable only now that all steps finished without error, so
    // that it remains undefined if this function exits early with error
    InstanceIdHash = instanceIdHash;

    return instance.obj;
}

/**
 * TODO REMOVE THIS FUNCTION - Just call instance-updater directly. This is a remnant from when
 * calling that module was cumbersome because it was a Plan module.
 *
 * Adds a recipe consisting of an array of objects of type RecipeRule for the given type
 * string. The recipe's rules are checked for the property names and the corresponding types but
 * no further: For example, if you forget "itemprop" (mandatory, a string) in a rule, or if you
 * have the wrong type of item on a rule property an Error is thrown. However, for "type" and
 * a rule's "itemprop" string property we only guard against HTML-breaking "<" and ">" and
 * against whitespace, and we don't check if any other recipes you refer to exist and a wide
 * range of conceivable problems.
 *
 * A recipe for a ONE object type consists of arrays of objects describing the data properties.
 * Allowed rule properties are explained in {@link RecipeRule}:
 *
 * ### Example
 *
 * The following code adds a recipe for a ONE object type "Mailbox":
 *
 * ```javascript
 * import * as ObjectRecipes from 'one.core/lib/object-recipes.js';
 *
 * if (!ObjectRecipes.hasRecipe('Mailbox')) {
 *     ObjectRecipes.addRecipeToRuntime({
 *         $type$: 'Recipe',
 *         name: 'Mailbox',
 *         rule: [
 *             // A SHA-256 hash pointing to an OneTest$ImapAccount object that this mailbox
 *             // belongs to. Both the account and the name are the ID attributes of this
 *             // VERSIONED object, meaning any Mailbox object with the same account and name
 *             // will be a version of the same object, varying only in the data properties not
 *             // marked as "isID:true".
 *             { itemprop: 'account', isId: true, referenceToObj: new Set(['Reference','Account'])
 * },
 *             { itemprop: 'name', isId: true },
 *             // This is an IMAP protocol feature to check if the IMAP-UIDs from last time are
 *             // still valid. This 32-bit integer can be fully represented by a Javascript number.
 *             { itemprop: 'uidValidity', valueType: 'number' },
 *             // A JSON-stringified UID => Email-BLOB-hash map
 *             { itemprop: 'uidEmailBlobMap', valueType: 'object' },
 *         ]
 *     });
 * }
 * ```
 *
 * A ONE object created using this recipe would look like this (indentation and newlines added
 * fore readability, not present in the actual microdata):
 *
 * ```html
 * <div itemscope itemtype="//refin.io/Mailbox">
 *   <span itemprop="account">8296cf598c1af767b5287....2bd96eae03448da3066aa</span>
 *   <span itemprop="name">INBOX</span>
 *   <span itemprop="uidValidity">1455785767</span>
 *   <span itemprop="uidEmailBlobMap">...[JSON]...</span>
 * </span>
 * ```
 * @static
 * @async
 * @param {Recipe[]} recipes - Array of {@link Recipe|ONE "Recipe" objects} to add to
 * the currently active instance **permanently**
 * @returns {ObjectCreation[]} Returns the result of creating the new Instance object
 * and the new Recipe objects
 */
export async function registerRecipes(
    recipes: Recipe[]
): Promise<ReturnType<typeof updateInstance>> {
    return await updateInstance({recipes});
}

/**
 * If initInstance() is to be called more than once close() must be called first. There can be
 * only a single ONE instance in a runtime environment. This is used by mocha storage tests which do
 * the same storage-init followed by storage-deletion for each test file.
 * @static
 * @returns {undefined}
 */
export function closeInstance(): void {
    closeStorage();
    lockKeyChain();
    clearRuntimeRecipes();
    clearRvMapTypes();

    InstanceName = undefined;
    InstanceIdHash = undefined;
    InstanceDirectory = undefined;
    InstaceOwnerEmail = undefined;
}

/**
 * Closes & deletes the current instance.
 *
 * When the InstanceIdHash is undefined the instance was not initialized or is already closed.
 * @returns {Promise<void>}
 */
export async function closeAndDeleteCurrentInstance(): Promise<void> {
    if (InstanceIdHash === undefined) {
        throw createError('IN-CADCI1');
    }

    const currentInstanceId = InstanceIdHash;

    closeInstance();

    await deleteStorage(currentInstanceId);
}

/**
 * Allows checking if an instance exists without an active instance.
 * @param {InstanceOptions.name} instanceName
 * @param {InstanceOptions.email} email
 * @returns {Promise<boolean>}
 */
export async function instanceExists(
    instanceName: InstanceOptions['name'],
    email: InstanceOptions['email']
): Promise<boolean> {
    const instanceIdHash = await calculateInstanceIdHash(instanceName, email);
    return await doesStorageExist(instanceIdHash);
}

/**
 * Allows deleting an instance without an active instance.
 * This is important e.g. in case of a forgotten password.
 *
 * @param {InstanceOptions.name} instanceName
 * @param {InstanceOptions.email} email
 * @returns {Promise<boolean>}
 */
export async function deleteInstance(
    instanceName: InstanceOptions['name'],
    email: InstanceOptions['email']
): Promise<void> {
    const instanceIdHash = await calculateInstanceIdHash(instanceName, email);

    if (!(await instanceExists(instanceName, email))) {
        // We want to throw an error if someone tries to delete an instance that
        // doesn't exist deleteStorage would silently ignore it.
        throw createError('IN-DI1', {instanceName, email});
    }

    await deleteStorage(instanceIdHash);
}

/**
 * Allows to calculate an instanceIdHash without an active instance needed to
 * 1. check if an inactive instance exists
 * 2. delete an inactive instance
 *
 * IMPORTANT: Needs to be adjusted by microdata changes
 *
 * @param {InstanceOptions.name} instanceName
 * @param {InstanceOptions.email} email
 * @returns {Promise<SHA256IdHash<Instance>>}
 */
export async function calculateInstanceIdHash(
    instanceName: InstanceOptions['name'],
    email: InstanceOptions['email']
): Promise<SHA256IdHash<Instance>> {
    const ownerIdHash = (await createCryptoHash(
        `<div ${ID_OBJECT_ATTR} itemscope itemtype="//refin.io/Person"><span itemprop="email">${email}</span></div>`
    )) as unknown as SHA256IdHash<Person>;

    return (await createCryptoHash(
        `<div ${ID_OBJECT_ATTR} itemscope itemtype="//refin.io/Instance"><span itemprop="name">${instanceName}</span><a itemprop="owner" data-type="id">${ownerIdHash}</a></div>`
    )) as unknown as SHA256IdHash<Instance>;
}
