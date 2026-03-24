import {Command} from '@commander-js/extra-typings';
import {COLOR} from '@refinio/one.core/lib/logger';
import {DefaultConfigLocation} from '../misc/commandsHelper';
import {assignConfigOption, readJsonFileOrEmpty} from '../misc/configHelper';
import {DefaultFilerConfig} from '../filer/FilerConfig';
import Replicant from '../Replicant';
import {checkReplicantConfig, DefaultReplicantConfig} from '../ReplicantConfig';

export const startCommand = new Command('start');

startCommand
    .description('Start one.filer service')
    .requiredOption('-s, --secret <string>', 'ONE instance password')
    .option(
        '-c, --config <string>',
        `The path to the configuration file. Defaults to "${DefaultConfigLocation}".`
    )
    .option(
        '-d, --directory <string>',
        'Path to desired location of the ONE data folder. Defaults to' +
            ` "${DefaultReplicantConfig.directory}" if not found in config.`
    )
    .option('-l, --log', 'Enable logging')
    .option('--log-debug', 'Enable logging with debug messages')
    .option(
        '--commServerUrl <URL>',
        'URL to a communication server. Defaults to' +
            ` "${DefaultReplicantConfig.commServerUrl}" if not found in config.`
    )
    .option(
        '--pairing-url <URL>',
        'URL to a one.leute instance for invites. Defaults to' +
            ` "${DefaultFilerConfig.pairingUrl}" if not found in config.`
    )
    .option(
        '--pairing-iom-mode <string>',
        'The mode of the iom: "full" or "light". Defaults to' +
            ` "${DefaultFilerConfig.iomMode}" if not found in config.`
    )
    .option(
        '--filer <boolean>',
        'Enable filer directory. Defaults to' +
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            ` "${DefaultReplicantConfig.useFiler}" if not found in config.`
    )
    .option(
        '--filer-log-calls <boolean>',
        'Enable logging of all filer calls. Defaults to' +
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            ` "${DefaultFilerConfig.logCalls}" if not found in config.`
    )
    .option(
        '--filer-mount-point <string>',
        'The filer mount point path. Defaults to' +
            ` "${DefaultFilerConfig.mountPoint}" if not found in config.`
    )
    .action(async options => {
        try {
            // Note: Logger options are currently not functional due to missing exports
            // TODO: Implement proper logging when one.core logger exports are available

            const config = await readJsonFileOrEmpty(options.config || 'config.json');
            const replicantConfig = checkReplicantConfig(config);

            assignConfigOption(replicantConfig, 'commServerUrl', options.commServerUrl);
            assignConfigOption(replicantConfig, 'useFiler', options.filer);
            assignConfigOption(replicantConfig, 'filer.pairingUrl', options.pairingUrl);
            assignConfigOption(replicantConfig, 'filer.iomMode', options.pairingIomMode);
            assignConfigOption(replicantConfig, 'filer.logCalls', options.filerLogCalls);
            assignConfigOption(replicantConfig, 'filer.mountPoint', options.filerMountPoint);

            // If no credentials exist create them
            const replicant = new Replicant(replicantConfig);
            await replicant.start(options.secret);

            console.log(`[info]: Replicant started successfully`);

            // Keep the application alive since FUSE needs to stay running
            // Without this, Node.js would exit after the Promise resolves
            const keepAlive = setInterval(() => {
                // Empty interval to keep event loop alive
                // FUSE operations will handle actual work
            }, 30000); // Check every 30 seconds

            process.on('SIGINT', async () => {
                try {
                    console.log('Shutting down...');
                    clearInterval(keepAlive);
                    await replicant.stop();
                    process.exit(0);
                } catch (err) {
                    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                    console.log(`${COLOR.FG_RED}${err}${COLOR.OFF}`);
                    process.exit(1);
                }
            });
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            console.log(`${COLOR.FG_RED}${err}${COLOR.OFF}`);
            process.exit(1);
        }
    });
