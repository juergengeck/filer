import tweetnacl from 'tweetnacl';
import {printUint8Array} from '../misc/LogUtils.js';

async function main(): Promise<void> {
    const keyPairAlice = tweetnacl.box.keyPair();
    const keyPairBob = tweetnacl.box.keyPair();

    printUint8Array('Alic Pub', tweetnacl.box.before(keyPairAlice.publicKey, keyPairBob.secretKey));
    printUint8Array('Bob pub', tweetnacl.box.before(keyPairBob.publicKey, keyPairAlice.secretKey));
}

// Execute main function
main().catch(e => {
    console.log('Error happened: ' + e.toString());
});
