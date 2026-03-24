import {expect} from 'chai';

import {
    closeInstance,
    getInstanceOwnerIdHash,
    initInstance
} from '@refinio/one.core/lib/instance.js';

import {SignatureReverseMaps} from '../lib/recipes/SignatureRecipes.js';
import {CertificateReverseMaps} from '../lib/recipes/Certificates/CertificateRecipes.js';
import {sign} from '../lib/misc/Signature.js';
import LeuteModel from '../lib/models/Leute/LeuteModel.js';
import RecipesExperimental from '../lib/recipes/recipes-experimental.js';
import RecipesStable from '../lib/recipes/recipes-stable.js';
import {initOneCorePlatform} from './_helpers.js';
import {createDummyObjectUnversioned, DummyObjectRecipes} from './utils/createDummyObject.js';
import {createTestIdentity} from './utils/createTestIdentity.js';
import {affirmForSomeoneElse} from './utils/affirmForSomeoneElse.js';

describe('Certificate test', () => {
    const leute = new LeuteModel('wss://dummy');

    beforeEach(async () => {
        await initOneCorePlatform();
        await initInstance({
            name: 'testname',
            email: 'test@test.com',
            secret: 'secret',
            wipeStorage: true,
            encryptStorage: false,
            directory: 'test/testDb',
            initialRecipes: [...RecipesStable, ...RecipesExperimental, ...DummyObjectRecipes],
            initiallyEnabledReverseMapTypes: new Map([
                ...SignatureReverseMaps,
                ...CertificateReverseMaps
            ])
        });
        await leute.init();
    });

    afterEach(async () => {
        await leute.shutdown();
        closeInstance();
    });

    it('Affirm something myself', async () => {
        const me = getInstanceOwnerIdHash();

        if (me === undefined) {
            throw new Error('Instance not initialized');
        }

        const data = (await createDummyObjectUnversioned('bla')).hash;

        expect(await leute.trust.isAffirmedBy(data, me)).to.be.false;
        expect(await leute.trust.affirmedBy(data)).to.be.eql([]);
        await leute.trust.affirm(data);
        expect(await leute.trust.isAffirmedBy(data, me)).to.be.true;
        expect(await leute.trust.affirmedBy(data)).to.be.eql([me]);
    });

    // Skipped - this test fails because we didn't add the keys of someone else to leute as
    // trusted keys
    it.skip('Affirm something by someone else', async () => {
        // Create an identity with brand new keys & data
        const other = await createTestIdentity('xyz');
        const data = (await createDummyObjectUnversioned('bla')).hash;
        expect(await leute.trust.isAffirmedBy(data, other.person)).to.be.false;
        expect(await leute.trust.affirmedBy(data)).to.be.eql([]);

        // Affirm it with the untrusted key of the other person
        await affirmForSomeoneElse(data, other.person, other.signKeyPair.secretKey);
        expect(await leute.trust.isAffirmedBy(data, other.person)).to.be.false;
        expect(await leute.trust.affirmedBy(data)).to.be.eql([]);

        // Trust the key
        await sign(other.keys);
        expect(await leute.trust.isAffirmedBy(data, other.person)).to.be.true;
        expect(await leute.trust.affirmedBy(data)).to.be.eql([other.person]);

        // Now affirm it myself to see if multiple persons are not a problem
        const me = getInstanceOwnerIdHash();

        if (me === undefined) {
            throw new Error('Instance not initialized');
        }

        await leute.trust.affirm(data);
        expect(await leute.trust.affirmedBy(data)).to.have.members([other.person, me]);
    });
});
