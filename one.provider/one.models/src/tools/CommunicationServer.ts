import yargs from 'yargs';

import * as Logger from '@refinio/one.core/lib/logger.js';

import CommunicationServer from '../misc/ConnectionEstablishment/communicationServer/CommunicationServer.js';

/**
 * Main function. This exists to be able to use await here.
 */
async function main(): Promise<void> {
    const argv = yargs(process.argv.slice(2))
        .options({
            // Url of communication server
            h: {
                longName: 'host',
                type: 'string',
                describe: 'Host to bind the listening port to',
                default: 'localhost'
            },
            // Spare connections
            p: {
                longName: 'port',
                type: 'number',
                describe: 'Port to listen on',
                default: 8000
            },
            // Ping interval
            tp: {
                type: 'number',
                describe: 'Ping intervall',
                default: 25000
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

    if (argv.l) {
        Logger.startLogger({types: ['log', 'debug']});
    }
    if (argv.d) {
        Logger.startLogger();
    }

    const commServer = new CommunicationServer();
    await commServer.start(argv.h, argv.p);

    // Stop comm server at sigint
    process.on('SIGINT', () => {
        commServer.stop().catch(_ignore => null);
    });
}

main().catch(e => {
    console.log('Error happened: ' + e.toString());
});
