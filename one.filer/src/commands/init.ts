import {Command} from '@commander-js/extra-typings';
import {COLOR} from '@refinio/one.core/lib/logger';
import {generateNewIdentity} from '@refinio/one.models/lib/misc/IdentityExchange';
import type {IdentityWithSecrets} from '@refinio/one.models/lib/misc/IdentityExchange';
import {
    readIdentityWithSecretsFile,
    writeNewIdentityToFile
} from '@refinio/one.models/lib/misc/IdentityExchange-fs';
import Replicant from '../Replicant';
import {DefaultConfigLocation, getStorageDirectoryFromConfig} from '../misc/commandsHelper';
import {DefaultReplicantConfig} from '../ReplicantConfig';

export const initCommand = new Command('init');

initCommand
    .description('Create a new replicant instance - optionally with pre-generated identity.')
    .requiredOption('-s, --secret <string>', 'ONE instance password')
    .option(
        '-c, --config <string>',
        'The configuration file is used to lookup the storage directory if not specified with' +
            ` -d. Defaults to ${DefaultConfigLocation}"`
    )
    .option(
        '-d, --directory <string>',
        'Path to desired location of the ONE data folder.' +
            ` Defaults to "${DefaultReplicantConfig.directory}" if not found in config.`
    )
    .option(
        '-i, --identityFile <string>',
        'Use this identity file with secrets to initialze the instance'
    )
    .option('-I, --createIdentityFile <string>', 'Creates the identity files with this prefix')
    .option(
        '-u, --url <string>',
        'When creating a new identity use this url. If readong an identity file overwrite the' +
            ' url with this one.'
    )
    .option(
        '-p, --personEmail <string>',
        'When creating a new identity use this person email. If reading an identity file' +
            ' overwrite the person email with this one.'
    )
    .option(
        '-n, --instanceName <string>',
        'When creating a new identity use this instance name. If reading an identity file' +
            ' overwrite the instance name with this one.'
    )
    .action(async options => {
        try {
            const storageDirectory = await getStorageDirectoryFromConfig(
                options.directory,
                options.config
            );

            if (await Replicant.instanceExists(storageDirectory)) {
                console.log(
                    `${COLOR.FG_RED}Replicant instance already exists. Delete it before you initialize a new one.${COLOR.OFF}`
                );
                process.exit(1);
            }

            let identityFile: IdentityWithSecrets;

            if (options.identityFile) {
                if (options.createIdentityFile) {
                    console.log(
                        `${COLOR.FG_RED}--identityFile and --createIdentityFile are mutually exclusive${COLOR.OFF}`
                    );
                    process.exit(1);
                }

                console.log(`Using identity file ${options.identityFile}`);
                identityFile = await readIdentityWithSecretsFile(options.identityFile);

                if (options.url !== undefined) {
                    identityFile.url = options.url;
                    console.log(
                        `${COLOR.FG_YELLOW}Overwriting url of identity file with ${options.url}${COLOR.OFF}`
                    );
                }

                if (options.personEmail !== undefined) {
                    identityFile.personEmail = options.personEmail;
                    console.log(
                        `${COLOR.FG_YELLOW}Overwriting person email of identity file with ${options.personEmail}${COLOR.OFF}`
                    );
                }

                if (options.instanceName !== undefined) {
                    identityFile.instanceName = options.instanceName;
                    console.log(
                        `${COLOR.FG_YELLOW}Overwriting person email of identity file with ${options.instanceName}${COLOR.OFF}`
                    );
                }
            } else if (options.createIdentityFile) {
                console.log(`Creating new identity file ${options.createIdentityFile}`);

                const newIdentity = await writeNewIdentityToFile(
                    options.createIdentityFile,
                    options.url,
                    options.personEmail,
                    options.instanceName
                );

                identityFile = newIdentity.secret;
            } else {
                const newIdentity = await generateNewIdentity(
                    options.url,
                    options.personEmail,
                    options.instanceName
                );

                identityFile = newIdentity.secret;
            }

            // If no credentials exist create them
            await Replicant.createReplicantInstance(identityFile, options.secret, storageDirectory);

            console.log(`${COLOR.FG_GREEN}[info]: Replicant instance created${COLOR.OFF}`);
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            console.log(`${COLOR.FG_RED}${err}${COLOR.OFF}`);
            process.exit(1);
        }
    });
