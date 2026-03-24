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
import yargs from 'yargs';

import * as Logger from '@refinio/one.core/lib/logger.js';
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
import IoMRequestManager from '../models/IoM/IoMRequestManager.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {ReverseMapsForIdObjectsStable, ReverseMapsStable} from '../recipes/reversemaps-stable.js';
import {
    ReverseMapsExperimental,
    ReverseMapsForIdObjectsExperimental
} from '../recipes/reversemaps-experimental.js';

/**
 * Parses command line options for this app.
 */
function parseCommandLine(): {
    commServerUrl: string;
    instanceName: string;
    displayDetails: boolean;
    createRequest: boolean;
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
            },
            // Logger
            r: {
                type: 'boolean',
                longName: 'request',
                describe: 'Create the request',
                default: false
            }
        })
        .parseSync();

    // Initialize Logger
    if (argv.l) {
        Logger.startLogger({types: ['log']});
    }
    if (argv.d) {
        Logger.startLogger();
    }

    return {
        commServerUrl: argv.u,
        instanceName: argv.i,
        displayDetails: argv.c,
        createRequest: argv.r
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
        initialRecipes: [...RecipesStable, ...RecipesExperimental],
        initiallyEnabledReverseMapTypes: new Map([
            ...ReverseMapsStable,
            ...ReverseMapsExperimental
        ]),
        initiallyEnabledReverseMapTypesForIdObjects: new Map([
            ...ReverseMapsForIdObjectsStable,
            ...ReverseMapsForIdObjectsExperimental
        ])
    });

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
 */
async function setupOneModels(commServerUrl: string): Promise<{
    channelManager: ChannelManager;
    leute: LeuteModel;
    connections: ConnectionsModel;
    iom: IoMRequestManager;
    shutdown: () => Promise<void>;
}> {
    // Construct models
    const leute = new LeuteModel(commServerUrl);
    const channelManager = new ChannelManager(leute);
    const connections = new ConnectionsModel(leute, {
        commServerUrl
    });
    const iom = new IoMRequestManager(leute.trust);

    // Initialize models
    await leute.init();
    await channelManager.init();
    await connections.init();
    await iom.init();

    // Setup shutdown
    async function shutdown(): Promise<void> {
        await iom.shutdown();
        await connections.shutdown();
        await channelManager.shutdown();
        await leute.shutdown();

        closeInstance();
    }

    return {
        leute,
        channelManager,
        connections,
        iom,
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
    iom: IoMRequestManager;
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
    const oneModels = await setupOneModels(commServerUrl);

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
 * Main function. This exists to be able to use await here.
 *
 * This main function just establishes connections to multiple instances and prints the
 * connection details every three seconds, so that you can see the number of connections that
 * are currently established.
 */
async function main(): Promise<void> {
    // CLI options parsing & init & shutdown on SIGINT
    const {commServerUrl, instanceName, displayDetails, createRequest} = parseCommandLine();
    const models = await initWithIdentityExchange(commServerUrl, instanceName);
    process.on('SIGINT', () => {
        clearInterval(intervalHandle);
        models.shutdown().catch(console.error);
    });

    // Print connection status continuously
    console.log('Owner:', getInstanceOwnerIdHash());
    console.log('Instance:', getInstanceIdHash());
    console.log('contacts:', models.contacts);
    const intervalHandle = setInterval(() => {
        const connectionInfos = models.connections.connectionsInfo();
        const connCount = connectionInfos.filter(info => info.isConnected).length;
        connectionInfos.map(info => info.isConnected);
        console.log(`OnelineState: ${models.connections.onlineState}`);
        console.log(`Connections established: ${connCount}`);
        if (displayDetails) {
            console.log(connectionInfos);
        }
    }, 3000);

    // Setup events
    models.iom.onRequestComplete((requestHash, request) => {
        console.log(`Request ${requestHash} created at ${request.timestamp} fulfilled.`);
    });

    // Do the IoMPairing
    if (createRequest) {
        const [me, ...others] = models.contacts;
        for (const other of others) {
            await models.iom.createIoMRequest(me, me, other);
        }
    } else {
        models.iom.onNewRequest((requestHash, request) => {
            console.log(`New request ${requestHash} received. Created at ${request.timestamp}.`);
            models.iom.affirmRequest(requestHash).catch(console.error);
        });
    }
}

// Execute main function
main().catch(e => {
    console.log(`Error happened: ${e.toString()}`, e.stack);
});
