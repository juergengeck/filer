import {checkReplicantConfig, DefaultReplicantConfig} from '../ReplicantConfig';
import {readJsonFileOrEmpty} from './configHelper';

export const DefaultConfigLocation = 'config.json';

/**
 * Convenience function for getting the storage directory from the command line or the
 * config.json file.
 *
 * Note: this is only useful if you only need the directory property. If you also need other
 * options from the config file, then this is not the function to use!
 *
 * @param directory - The value the was passed to the command line or undefined if none was passed.
 * @param configFileName - The configuration file name where to lookup the directory. If non was
 * passed, use the default.
 */
export async function getStorageDirectoryFromConfig(
    directory?: string,
    configFileName?: string
): Promise<string> {
    if (directory !== undefined) {
        return directory;
    }

    const config = await readJsonFileOrEmpty(configFileName || DefaultConfigLocation);
    const replicantConfig = checkReplicantConfig(config);

    if (replicantConfig.directory !== undefined) {
        return replicantConfig.directory;
    }

    return DefaultReplicantConfig.directory;
}
