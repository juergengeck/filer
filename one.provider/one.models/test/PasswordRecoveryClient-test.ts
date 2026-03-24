import {expect} from 'chai';
import type {RecoveryInformation} from '../lib/misc/PasswordRecoveryService/PasswordRecovery.js';
import PasswordRecoveryClient from '../lib/misc/PasswordRecoveryService/PasswordRecoveryClient.js';
import PasswordRecoveryServer from '../lib/misc/PasswordRecoveryService/PasswordRecoveryServer.js';
import {generateNewIdentity} from '../lib/misc/IdentityExchange.js';
import {getBaseDirOrName, setBaseDirOrName} from '@refinio/one.core/lib/system/storage-base.js';
import {mkdir} from 'fs/promises';
import {defaultDbName, initOneCorePlatform} from './_helpers.js';

describe('Password recovery test over server', () => {
    let server: PasswordRecoveryServer;
    let client: PasswordRecoveryClient;

    beforeEach(async () => {
        await initOneCorePlatform();
        setBaseDirOrName(`test/${defaultDbName}`);
        await mkdir(getBaseDirOrName(), {recursive: true});
        const identity = await generateNewIdentity('http://localhost:8080');
        server = new PasswordRecoveryServer(identity.secret, 8080);
        await server.start();
        client = new PasswordRecoveryClient(identity.public);
    });

    afterEach(async () => {
        await server.stop();
    });

    it('Standard workflow', async () => {
        const waitForRequestPromise = new Promise<RecoveryInformation>((resolve, reject) => {
            const handle = setTimeout(() => reject(new Error('Timeout')), 1000);
            server.onPasswordRecoveryRequest(info => {
                clearTimeout(handle);
                resolve(info);
            });
        });

        const secret = 'secret2';
        const id = 'me@nowhere.invalid';
        await client.createAndStoreRecoveryInformation(secret, id);
        await client.sendRecoveryInformationToServer();

        const recoveryInformation = await waitForRequestPromise;

        expect(recoveryInformation.identity).to.be.equal(id);
        const recoveredSecret = await client.recoverSecretAsString(
            recoveryInformation.symmetricKey
        );
        expect(recoveredSecret).to.be.equal(secret);
    });
});
