import {Command} from '@commander-js/extra-typings';
import {COLOR} from '@refinio/one.core/lib/logger';
import Replicant from '../Replicant';
import {DefaultConfigLocation, getStorageDirectoryFromConfig} from '../misc/commandsHelper';
import {DefaultReplicantConfig} from '../ReplicantConfig';

export const deleteCommand = new Command('delete');

deleteCommand
    .description('Delete the replicants data  directory')
    .option(
        '-c, --config <string>',
        'The configuration file is used to lookup the storage directory if not specified with' +
            ` -d. Defaults to "${DefaultConfigLocation}"`
    )
    .option(
        '-d, --directory <string>',
        'Path to desired location of the ONE data folder.' +
            ` Defaults to "${DefaultReplicantConfig.directory}" if not found in config.`
    )
    .action(async options => {
        try {
            const storageDirectory = await getStorageDirectoryFromConfig(
                options.directory,
                options.config
            );
            await Replicant.deleteInstance(storageDirectory);
            console.log('Instance was deleted.');
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            console.log(`${COLOR.FG_RED}${err}${COLOR.OFF}`);
            process.exit(1);
        }
    });
