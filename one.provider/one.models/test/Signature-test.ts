import {expect} from 'chai';

import {
    closeInstance,
    getInstanceOwnerIdHash,
    initInstance
} from '@refinio/one.core/lib/instance.js';

import {SignatureReverseMaps} from '../lib/recipes/SignatureRecipes.js';
import {sign} from '../lib/misc/Signature.js';
import LeuteModel from '../lib/models/Leute/LeuteModel.js';
import RecipesExperimental from '../lib/recipes/recipes-experimental.js';
import RecipesStable from '../lib/recipes/recipes-stable.js';

import {createTestIdentity} from './utils/createTestIdentity.js';
import {createDummyObjectUnversioned, DummyObjectRecipes} from './utils/createDummyObject.js';
import {signForSomeoneElse} from './utils/signForSomeoneElse.js';

import {SYSTEM} from '@refinio/one.core/lib/system/platform.js';
await import(`@refinio/one.core//lib/system/load-${SYSTEM}.js`);

describe('Signature test', () => {
    const leute = new LeuteModel('wss://dummy');

    beforeEach(async () => {
        await initInstance({
            name: 'testname',
            email: 'test@test.com',
            secret: 'secret',
            wipeStorage: true,
            encryptStorage: false,
            directory: 'test/testDb',
            initialRecipes: [...RecipesStable, ...RecipesExperimental, ...DummyObjectRecipes],
            initiallyEnabledReverseMapTypes: new Map([...SignatureReverseMaps])
        });
        await leute.init();
    });

    afterEach(async () => {
        await leute.shutdown();
        closeInstance();
    });

    it('Sign object by me', async () => {
        const me = getInstanceOwnerIdHash();

        if (me === undefined) {
            throw new Error('Instance not initialized');
        }

        const data = (await createDummyObjectUnversioned('bla')).hash;

        const signPersons1 = await leute.trust.signedBy(data);
        expect(signPersons1.length).to.be.equal(0);
        expect(await leute.trust.isSignedBy(data, me)).to.be.false;

        await sign(data);

        const signPersons2 = await leute.trust.signedBy(data);
        expect(signPersons2.length).to.be.equal(1);
        expect(signPersons2[0]).to.be.equal(me);
        expect(await leute.trust.isSignedBy(data, me)).to.be.true;
    });

    // Skipped - this test fails because we didn't add the keys of someone else to Leute as
    // trusted keys
    it.skip('Sign object by someone else (trusted keys test)', async () => {
        // Create an identity with brand new keys & data & sign the data with this new identity.
        const other = await createTestIdentity('xyz');
        const data = (await createDummyObjectUnversioned('bla')).hash;
        await signForSomeoneElse(data, other.person, other.signKeyPair.secretKey);

        // Check the signature (I did not approve the key)
        const signPersons1 = await leute.trust.signedBy(data);
        expect(signPersons1.length).to.be.equal(0);
        expect(await leute.trust.isSignedBy(data, other.person)).to.be.false;

        await sign(other.keys);

        // Check the signature (I did approve the key)
        const signPersons2 = await leute.trust.signedBy(data);
        expect(signPersons2.length).to.be.equal(1);
        expect(signPersons2[0]).to.be.equal(other.person);
        expect(await leute.trust.isSignedBy(data, other.person)).to.be.true;
    });
});
