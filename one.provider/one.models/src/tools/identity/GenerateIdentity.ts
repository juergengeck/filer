import {writeNewIdentityToFile} from '../../misc/IdentityExchange-fs.js';

(async () => {
    if (process.argv.length !== 3 && process.argv.length !== 4) {
        console.error(`${process.argv[1]} <filename_prefix> <commserverurl>`);
        process.exit(1);
    }

    const filenamePrefix = process.argv[2];
    const commServerUrl = process.argv.length < 4 ? 'ws://localhost:8000' : process.argv[3];
    const output = await writeNewIdentityToFile(filenamePrefix, commServerUrl);

    console.log('Created files:');
    console.log(output.secretFileName);
    console.log(output.publicFileName);
})().catch(err => console.error(err));
