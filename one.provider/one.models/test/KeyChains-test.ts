import {closeInstance, initInstance} from '@refinio/one.core/lib/instance.js';

import SignatureRecipes, {SignatureReverseMaps} from '../lib/recipes/SignatureRecipes.js';
import CertificateRecipes, {
    CertificateReverseMaps
} from '../lib/recipes/Certificates/CertificateRecipes.js';
import {initOneCorePlatform} from './_helpers.js';
import {DummyObjectRecipes} from './utils/createDummyObject.js';
import LeuteModel from '../lib/models/Leute/LeuteModel.js';
import LeuteRecipes from '../lib/recipes/Leute/recipes.js';
import InstancesRecipes from '../lib/recipes/InstancesRecipies.js';

describe('Keychains test', () => {
    let leute: LeuteModel;

    beforeEach(async () => {
        await initOneCorePlatform();
        await initInstance({
            name: 'testname',
            email: 'test@test.com',
            secret: 'secret',
            wipeStorage: true,
            encryptStorage: false,
            directory: 'test/testDb',
            initialRecipes: [
                ...CertificateRecipes,
                ...SignatureRecipes,
                ...DummyObjectRecipes,
                ...LeuteRecipes,
                ...InstancesRecipes
            ],
            initiallyEnabledReverseMapTypes: new Map([
                ...SignatureReverseMaps,
                ...CertificateReverseMaps
            ])
        });

        leute = new LeuteModel('ws://localhost:8000');
        await leute.init();
    });

    afterEach(async () => {
        await leute.shutdown();
        closeInstance();
    });

    it('Do stuff', async () => {
        //TBD
    });
});
