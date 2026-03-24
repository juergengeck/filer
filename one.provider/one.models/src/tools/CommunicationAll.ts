/**
 * This file is a minimal example for using multiple ONE instances.
 *
 * This example sets up a single one instance and tries to connect to other instances. It will
 * print the status of the established connections every three seconds.
 *
 * Q: How do the individual one instances find each other?
 * A: Each instance writes its own identity / contact information into a file (name.id.json) and
 * other instances import it and then know how to contact this instance.
 *
 * How you use this script:
 * Step 1: You have to start a communication server that relays all information
 *     Terminal 1: node ./lib/tools/CommunicationServer
 * Step 2: You call this script in multiple terminals with different instance names:
 *     Terminal 2: node ./lib/tools/CommunicationAll -i i1
 *     Terminal 3: node ./lib/tools/CommunicationAll -i i2
 *     ...
 *
 *     This will write a file with <name>.id.json for each instance, so
 *     - i1.is.json
 *     - i2.id.json
 *     ...
 * Step 3:
 *     After all terminals prompt you with
 *     "Press a key to continue when you started all other processes ..."
 *     you press a key in each terminal
 *
 *     This will import all *.id.json files in the current process and the app will start making
 *     connections to all others.
 * Step 4:
 *     The app will now print every 3 seconds the number of established connections. If you kill
 *     one or more instances the count for the others goes down. If you restart them, the count
 *     goes up again.
 */

import {createAccess} from '@refinio/one.core/lib/access.js';
import yargs from 'yargs';

import * as Logger from '@refinio/one.core/lib/logger.js';
import {objectEvents} from '../misc/ObjectEventDispatcher.js';
import ChannelManager from '../models/ChannelManager.js';
import ConnectionsModel from '../models/ConnectionsModel.js';
import LeuteModel from '../models/Leute/LeuteModel.js';
import {
    closeInstance,
    getInstanceIdHash,
    getInstanceOwnerIdHash,
    initInstance
} from '@refinio/one.core/lib/instance.js';
import RecipesStable from '../recipes/recipes-stable.js';
import RecipesExperimental from '../recipes/recipes-experimental.js';
import {waitForKeyPress} from './cliHelpers.js';
import {
    importIdentityFilesAsProfiles,
    readOrCreateIdentityFile
} from '../misc/IdentityExchange-fs.js';
import type {Identity, IdentityWithSecrets} from '../misc/IdentityExchange.js';
import {convertIdentityToInstanceOptions} from '../misc/IdentityExchange.js';
import {getInstancesOfPerson, getLocalInstanceOfPerson} from '../misc/instance.js';
import {getListOfKeys, hasDefaultKeys} from '@refinio/one.core/lib/keychain/keychain.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Keys, Person} from '@refinio/one.core/lib/recipes.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import '@refinio/one.core/lib/system/load-nodejs.js';

/**
 * Parses command line options for this app.
 */
function parseCommandLine(): {
    commServerUrl: string;
    instanceName: string;
    displayDetails: boolean;
} {
    const argv = yargs(process.argv.slice(2))
        .options({
            // Url of communication server
            u: {
                longName: 'u',
                type: 'string',
                describe: 'Url of communication server.',
                default: 'ws://localhost:8000'
            },
            // Instance name that shall be used
            i: {
                longName: 'i',
                type: 'string',
                describe: 'Instance name',
                demandOption: true
            },
            // Display connection details
            c: {
                type: 'boolean',
                describe: 'Display connection details',
                default: false
            },
            // Logger
            l: {
                type: 'boolean',
                longName: 'logger',
                describe: 'Enable logger'
            },
            // Logger
            d: {
                type: 'boolean',
                longName: 'debugging',
                describe: 'Enable logger (all)'
            }
        })
        .parseSync();

    // Initialize Logger
    if (argv.l) {
        Logger.startLogger({
            types: [
                'chum-sync:log',
                'chum-sync:debug',
                'chum-importer:log',
                'chum-importer:debug',
                'chum-importer-request-functions:log',
                'chum-importer-request-functions:debug',
                'chum-exporter:log',
                'chum-exporter:debug' /*,
                'ChannelManager:log',
                'ChannelManager:debug'*/
            ] as unknown as ['debug', 'log', 'alert', 'error']
        });
    }
    if (argv.d) {
        Logger.startLogger();
    }

    return {
        commServerUrl: argv.u,
        instanceName: argv.i,
        displayDetails: argv.c
    };
}

/**
 * Setup the one.core specific stuff.
 *
 * This just initializes the instance.
 *
 * @param identity
 */
async function setupOneCore(identity: Identity | IdentityWithSecrets): Promise<{
    shutdown: () => Promise<void>;
}> {
    await initInstance({
        ...convertIdentityToInstanceOptions(identity, 'dummy'),
        encryptStorage: false,
        directory: 'OneDB',
        initialRecipes: [...RecipesStable, ...RecipesExperimental]
    });

    const owner = getInstanceOwnerIdHash();
    if (owner === undefined) {
        throw new Error('blablabl');
    }
    const hasDKeys = await hasDefaultKeys(owner);
    const instances = await getInstancesOfPerson(owner);
    const instance = await getLocalInstanceOfPerson(owner);
    console.log(`##### instance ${instance} ${hasDKeys}`, instances);

    async function shutdown(): Promise<void> {
        closeInstance();
    }
    return {shutdown};
}

/**
 * Setup the one.models stuff
 *
 * This initializes the models and imports the plan modules (code managed by one)
 *
 * @param commServerUrl
 * @param noImport
 * @param noExport
 */
async function setupOneModels(
    commServerUrl: string,
    noImport = false,
    noExport = false
): Promise<{
    channelManager: ChannelManager;
    leute: LeuteModel;
    connections: ConnectionsModel;
    shutdown: () => Promise<void>;
}> {
    await objectEvents.init();

    // Construct models
    const leute = new LeuteModel(commServerUrl);
    const channelManager = new ChannelManager(leute);
    const connections = new ConnectionsModel(leute, {
        commServerUrl,
        noImport,
        noExport
    });

    // Initialize models
    await leute.init();
    await channelManager.init();
    await connections.init();

    // Setup shutdown
    async function shutdown(): Promise<void> {
        await connections.shutdown();
        await channelManager.shutdown();
        await leute.shutdown();

        closeInstance();
    }

    return {
        leute,
        channelManager,
        connections,
        shutdown
    };
}

/**
 * Initialize everything (one.core and one.models) and exchange identities with other instances.
 *
 * The identity exchange between instances is done by files that contain all the necessary
 * information to establish a connection between instances.
 *
 * The detailed workflow is this:
 * 1) This function will write an instanceName.id.json file that contains the contact information
 *    of this instance
 * 2) Everything (one.core & one.models) will be initialized
 * 3) The process waits for the user to press a key. Before pressing the key the user needs to
 *    spin up the other instance processes, so that they can write their *.id.json files (they
 *    need a different instanceName !)
 * 4) After the user presses a key all other .id.json files will be imported into this instance
 *    As a result connections will automatically be opened to all other instances.
 *
 * Notes:
 * - The connections will be always established to all known other instances as soon as the
 *   connectionsModel is initialized. There is no way to turn off individual connections at the
 *   moment (future feature). The only way to shut down connections is to shutdown the connections
 *   model.
 * - In the default connection model configuration the connection between two instances will only
 *   work if both instances know each other. Connection attempts from unknown instances are refused.
 * - At the moment everything is relayed through a comm server, because browsers cannot open
 *   ports for incoming connections. For node processes we have the necessary code to accept
 *   incoming connections, but we don't have a configuration flag to enable this, yet.
 *
 * @param commServerUrl - The url of the commserver to use.
 * @param instanceName - The name of the instance to use. This needs to be unique between all
 *                       connected instances, because the written identity files uses this
 *                       string as file name.
 */
async function initWithIdentityExchange(
    commServerUrl: string,
    instanceName: string
): Promise<{
    channelManager: ChannelManager;
    leute: LeuteModel;
    connections: ConnectionsModel;
    shutdown: () => Promise<void>;
    contacts: SHA256IdHash<Person>[];
}> {
    // ######## Step 1: Create own identity (if not already done) and setup app ########
    const identity = await readOrCreateIdentityFile(
        `${instanceName}.id.json`,
        commServerUrl,
        undefined,
        instanceName
    );

    const oneCore = await setupOneCore(identity);
    const oneModels = await setupOneModels(commServerUrl /*, instanceName === '1'*/);

    async function shutdown(): Promise<void> {
        console.log('Shutting down application');
        await oneModels.shutdown();
        await oneCore.shutdown();
    }

    // ######## Step 2: Import other identities ########

    // Wait for all apps to have written their identity files ...
    await waitForKeyPress('Press a key to continue when you started all other processes ...');
    // ... and then import them
    const profiles = await importIdentityFilesAsProfiles(`${instanceName}.id.json`);
    console.log(`Imported ${profiles.length} profiles.`);

    const owner = getInstanceOwnerIdHash();
    if (owner === undefined) {
        throw new Error('Failed to obtain owner');
    }

    return {
        ...oneModels,
        shutdown,
        contacts: [owner, ...profiles.map(profile => profile.personId)]
    };
}

/**
 * Print instances and keys of the passed owner.
 *
 * @param owner
 */
async function printInstancesAndKeys(owner: SHA256IdHash<Person>) {
    console.log(`## Owner: ${owner} ##`);

    const keys = await getListOfKeys(owner);
    console.log('- Owner keys', await transformKeys(keys));

    const instances = await getInstancesOfPerson(owner);
    for (const instance of instances) {
        const instanceKeys = await getListOfKeys(instance.instanceId);
        console.log(`- Instance: ${instance.instanceId} ${instance.local}`);
        console.log('- Instance keys', await transformKeys(instanceKeys));
    }
}

/**
 * Add the keys themselves to the object, so that it can be printed.
 *
 * @param keys
 */
async function transformKeys(
    keys: Array<{
        keys: SHA256Hash<Keys>;
        complete: boolean;
        default: boolean;
    }>
): Promise<
    Array<{
        keys: SHA256Hash<Keys>;
        complete: boolean;
        default: boolean;
        encryptionKey: HexString;
        signKey: HexString;
    }>
> {
    return Promise.all(
        keys.map(async key => {
            const keyObj = await getObject(key.keys);
            return {
                ...key,
                encryptionKey: keyObj.publicKey,
                signKey: keyObj.publicSignKey
            };
        })
    );
}

/**
 * Main function. This exists to be able to use await here.
 *
 * This main function just establishes connections to multiple instances and prints the
 * connection details every three seconds, so that you can see the number of connections that
 * are currently established.
 */
async function main(): Promise<void> {
    // CLI options parsing & init & shutdown on SIGINT
    const {commServerUrl, instanceName, displayDetails} = parseCommandLine();
    const models = await initWithIdentityExchange(commServerUrl, instanceName);
    process.on('SIGINT', () => {
        clearInterval(intervalHandle);
        models.shutdown().catch(console.error);
    });

    // Share some channel
    const channelInfoIdHash = await models.channelManager.createChannel('TestChannel', null);
    await models.channelManager.postToChannel(
        'TestChannel',
        {
            $type$: 'ChatMessage',
            text: `Hello from ${models.contacts[0]}`,
            sender: models.contacts[0]
        },
        null
    );

    await createAccess([
        {
            id: channelInfoIdHash,
            person: models.contacts.slice(1),
            group: [],
            mode: 'add'
        }
    ]);

    // Print connection status continuously
    console.log('Owner:', getInstanceOwnerIdHash());
    console.log('Instance:', getInstanceIdHash());
    const intervalHandle = setInterval(async () => {
        console.log('#### Chat content ####');
        for await (const msg of models.channelManager.objectIteratorWithType('ChatMessage', {
            channelInfoIdHash
        })) {
            console.log(msg.data.text);
        }

        //console.log(`OnelineState: ${models.connections.onlineState}`);
        //models.connections.debugDump();

        if (displayDetails) {
            const me = await models.leute.me();
            console.log('#### Me Someone ####');
            for (const identity of me.identities()) {
                await printInstancesAndKeys(identity);
            }

            const others = await models.leute.others();
            for (const other of others) {
                console.log('#### Other Someone ####');
                for (const identity of other.identities()) {
                    await printInstancesAndKeys(identity);
                }
            }
        }
    }, 3000);
}

main().catch(e => {
    console.log(`Error happened: ${String(e)}, ${e.stack}`);
});

/* Example of how to get the external connection info:

// After successful authentication with the commserver
const connection = await CommunicationServerListener.establishConnection(
    commServerUrl, 
    cryptoApi,
    onConnect
);

// The external connection info is now available
const externalInfo = connection.getExternalConnectionInfo();
if (externalInfo) {
    console.log(`External IP: ${externalInfo.ip}, Port: ${externalInfo.port}`);
}
*/
