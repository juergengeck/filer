import {mkdir} from 'fs/promises';

import {getBaseDirOrName, setBaseDirOrName} from '@refinio/one.core/lib/system/storage-base.js';

import {readIdentityFile} from '../../misc/IdentityExchange-fs.js';
import PasswordRecoveryClient from '../../misc/PasswordRecoveryService/PasswordRecoveryClient.js';

function parseCommandLine(argv: string[]): {
    secret: string;
    identity: string;
    identityFileName: string;
} {
    function getUsage() {
        return `usage: ${argv[0]} ${argv[1]} <secret> <identity> [identityFileName]`;
    }

    if (argv.length < 3 || argv.length > 5) {
        console.error(getUsage());
        process.exit(1);
    }

    const params = {
        secret: '',
        identity: '',
        identityFileName: 'pw.id.json'
    };

    if (argv[2] === '-h') {
        console.log(getUsage());
        process.exit(0);
    }

    params.secret = argv[2];
    params.identity = argv[3];

    if (argv.length === 5) {
        params.identityFileName = argv[4];
    }

    return params;
}

/**
 * Main function to handle password recovery request
 */
async function main(): Promise<void> {
    setBaseDirOrName('OneDB');
    await mkdir(getBaseDirOrName(), {recursive: true});
    const cmdArgs = parseCommandLine(process.argv);
    const identity = await readIdentityFile(cmdArgs.identityFileName);

    const client = new PasswordRecoveryClient(identity);
    await client.createAndStoreRecoveryInformation(cmdArgs.secret, cmdArgs.identity);
    await client.sendRecoveryInformationToServer();
}

main().catch(console.error);
