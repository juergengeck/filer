import {mkdir, writeFile} from 'fs/promises';
import path from 'path';

import {readIdentityWithSecretsFile} from '../../misc/IdentityExchange-fs.js';
import PasswordRecoveryServer from '../../misc/PasswordRecoveryService/PasswordRecoveryServer.js';

function parseCommandLine(argv: string[]): {
    outputFolder: string;
    identityFileName: string;
    port: number;
} {
    function getUsage() {
        return 'Usage: node PasswordRecoveryServer.js [port] [outputFolder] [identityFileName]';
    }

    if (argv.length > 5 || argv.includes('-h')) {
        console.error(getUsage());
        process.exit(1);
    }

    const params = {
        outputFolder: 'passwordRecoveryRequests',
        identityFileName: 'pw_secret.id.json',
        port: 8080
    };

    if (argv.length >= 3) {
        params.port = parseInt(argv[2], 10);
    }

    if (argv.length >= 4) {
        params.outputFolder = argv[3];
    }

    if (argv.length >= 5) {
        params.identityFileName = argv[4];
    }

    return params;
}

async function main(): Promise<void> {
    const cmdArgs = parseCommandLine(process.argv);
    const identity = await readIdentityWithSecretsFile(cmdArgs.identityFileName);

    await mkdir(cmdArgs.outputFolder, {recursive: true});

    const server = new PasswordRecoveryServer(identity, cmdArgs.port);
    server.onPasswordRecoveryRequest(request => {
        console.log('Received request');
        writeFile(
            path.join(cmdArgs.outputFolder, Date.now().toString()),
            JSON.stringify(request)
        ).catch(err => console.error(err));
    });

    process.on('SIGINT', () => {
        console.log(`PasswordRecoveryServer port ${cmdArgs.port} shutdown.`);
        server.stop().catch(err => console.error(err));
    });

    console.log(`PasswordRecoveryServer port ${cmdArgs.port} start.`);
    await server.start();
}

main().catch(console.error);
