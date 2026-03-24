/**
 * @author
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 */

// CRITICAL: Load Node.js platform modules for one.core before any other imports
import '@refinio/one.core/lib/system/load-nodejs.js';

import {program} from '@commander-js/extra-typings';
import {configureCommand} from './commands/configure';
import {deleteCommand} from './commands/delete';
import {initCommand} from './commands/init';
import {startCommand} from './commands/start';
import {writeDefaultConfigCommand} from './commands/write-default-config';

async function main(): Promise<void> {
    process.on('uncaughtException', (err, origin) => {
        console.log(`Uncaught ${err.name}, Origin: ${origin}`);
        console.error(err.message);
        console.error(err.stack);
    });

    await program
        // .configureOutput({
        //     writeOut: str => console.log(`${str}`),
        //     writeErr: () => {
        //         // ...
        //     },
        //     outputError: () => {
        //         // ...
        //     }
        // })
        .name('one.replicant')
        .version('0.0.0', '-v, --version', 'Display the version')
        .description('Command Line Interface for ONE based applications')
        .addCommand(configureCommand)
        .addCommand(deleteCommand)
        .addCommand(initCommand)
        .addCommand(startCommand, {isDefault: true})
        .addCommand(writeDefaultConfigCommand)
        .parseAsync();
}

main().catch(err => {
    console.log('Caught error in main: ');
    console.log(err);
    process.exit(1);
});
