import {expect} from 'chai';

import {buildTestFile, init} from './_helpers.js';
import ConsentModel from '../lib/models/ConsentModel.js';
import TestModel from './utils/TestModel.js';
import {closeAndDeleteCurrentInstance} from '@refinio/one.core/lib/instance.js';
import {getObjectWithType} from '@refinio/one.core/lib/storage-unversioned-objects.js';

import {SYSTEM} from '@refinio/one.core/lib/system/platform.js';
await import(`@refinio/one.core//lib/system/load-${SYSTEM}.js`);

let testModel: TestModel;

describe('Consent', () => {
    before(async () => {
        await init();
        const model = new TestModel('ws://localhost:8000');
        await model.init(undefined);
        testModel = model;
    });
    after(async () => {
        await testModel.shutdown();
        await closeAndDeleteCurrentInstance();
    });

    it('should be uninitialised', function () {
        //test
        const consentModel = new ConsentModel();
        expect(consentModel.consentState.currentState).to.equal('Uninitialised');
    });

    it('should init without consent', async function () {
        const consentModel = new ConsentModel();
        await consentModel.init(testModel.channelManager);
    });

    it('should add a conset to the queue', async function () {
        const consentModel = new ConsentModel();
        const consentFile = buildTestFile();

        await consentModel.setConsent(consentFile, 'given');
    });

    it('should write consent to channel after one is initialized ', async function () {
        const consentModel = new ConsentModel();
        const file = buildTestFile();

        await consentModel.setConsent(file, 'given');

        // equals ONE is initialized
        await consentModel.init(testModel.channelManager);

        expect(consentModel.consentState.currentState).to.equal('Given');
    });

    it('should change the state from given to revoked', async function () {
        const consentModel = new ConsentModel();
        const file = buildTestFile();

        await consentModel.setConsent(file, 'revoked');
        expect(consentModel.consentState.currentState).to.equal('Revoked');
    });

    it('should load latest state from storage', async function () {
        const consentModel = new ConsentModel();
        expect(consentModel.consentState.currentState).to.equal('Uninitialised');

        // equals ONE is initialized
        await consentModel.init(testModel.channelManager);

        // the latest WRITTEN consent was in test "should write consent to channel after one is initialized"
        expect(consentModel.consentState.currentState).to.equal('Given');
    });

    it('should trigger something on state beeng revoked', async function () {
        const consentModel = new ConsentModel();
        expect(consentModel.consentState.currentState).to.equal('Uninitialised');

        const onEnterRevokeState = new Promise(resolve => {
            consentModel.consentState.onEnterState(state => {
                if (state === 'Revoked') {
                    resolve('Close connection to replicant');
                }
            });
        });

        const file = buildTestFile();
        await consentModel.setConsent(file, 'given');
        await consentModel.setConsent(file, 'revoked');

        const revoked = await onEnterRevokeState;
        expect(revoked).to.equal('Close connection to replicant');
    });

    it('should have the revoked state after init if the last stored consent was revoked', async function () {
        const consentModel = new ConsentModel();
        const file = buildTestFile();

        await consentModel.setConsent(file, 'revoked');

        // equals ONE is initialized
        await consentModel.init(testModel.channelManager);
        await consentModel.shutdown();

        expect(consentModel.consentState.currentState).to.equal('Uninitialised');

        await consentModel.init(testModel.channelManager);
        expect(consentModel.consentState.currentState).to.equal('Revoked');
    });

    it('should have the right firstConsentDate', async function () {
        const consentModel = new ConsentModel();
        await consentModel.init(testModel.channelManager);
        const allChannelEntrys = await testModel.channelManager.getObjects({
            channelId: ConsentModel.channelId
        });
        const allConsents = await Promise.all(
            allChannelEntrys.map(entry =>
                getObjectWithType((entry.data as any).data, 'Consent_1_1_0')
            )
        );

        if (consentModel.firstConsentDate === undefined) {
            throw new Error('consentModel.firstConsentDate is undefined');
        }
        expect(consentModel.firstConsentDate.toISOString()).to.be.equal(
            allConsents[0].isoStringDate
        );
    });

    it('should have the right firstConsentDate even with queued consents', async function () {
        const consentModel = new ConsentModel();
        const file = buildTestFile();
        await consentModel.setConsent(file, 'given');

        await consentModel.init(testModel.channelManager);
        const allChannelEntrys = await testModel.channelManager.getObjects({
            channelId: ConsentModel.channelId
        });
        const allConsents = await Promise.all(
            allChannelEntrys.map(entry =>
                getObjectWithType((entry.data as any).data, 'Consent_1_1_0')
            )
        );

        if (consentModel.firstConsentDate === undefined) {
            throw new Error('consentModel.firstConsentDate is undefined');
        }
        expect(consentModel.firstConsentDate.toISOString()).to.be.equal(
            allConsents[0].isoStringDate
        );
    });
});
