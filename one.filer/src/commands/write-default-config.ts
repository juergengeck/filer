import {Command} from '@commander-js/extra-typings';
import {COLOR} from '@refinio/one.core/lib/logger';
import fs from 'fs';
import {DefaultReplicantConfig} from '../ReplicantConfig';

export const writeDefaultConfigCommand = new Command('write-default-config');

writeDefaultConfigCommand
    .description('Write a default config')
    .arguments('<file-name>')
    .action(async fileName => {
        try {
            const outputFile = fileName;
            await fs.promises.writeFile(
                outputFile,
                JSON.stringify(DefaultReplicantConfig, null, 4)
            );
            console.log(`Config file was written to ${outputFile}`);
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            console.log(`${COLOR.FG_RED}${err}${COLOR.OFF}`);
            process.exit(1);
        }
    });
