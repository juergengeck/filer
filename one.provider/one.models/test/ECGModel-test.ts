/**
 * @author Sebastian Șandru <sebastian@refinio.net>
 */
import {expect} from 'chai';
import {closeAndDeleteCurrentInstance} from '@refinio/one.core/lib/instance.js';
import * as StorageTestInit from './_helpers.js';
import TestModel from './utils/TestModel.js';
import type ECGModel from '../lib/models/ECGModel.js';
import type {Electrocardiogram} from '../lib/recipes/ECGRecipes.js';

let ecgModel: ECGModel;
let testModel: TestModel;

describe('ECG Model test', () => {
    before(async () => {
        await StorageTestInit.init();
        const model = new TestModel('ws://localhost:8000');
        await model.init(undefined);
        testModel = model;
        ecgModel = model.ecgModel;
    });
    after(async () => {
        await testModel.shutdown();
        await closeAndDeleteCurrentInstance();
    });

    it('Should create an ECG with 15000 readings', async () => {
        const readings = [];
        for (let i = 0; i < 15000; i++) {
            readings.push({timeSinceSampleStart: i, leadVoltage: Math.random()});
        }
        const ECG: Electrocardiogram = {
            $type$: 'Electrocardiogram',
            voltageMeasurements: 0,
            readings: readings
        };

        await ecgModel.postECG(ECG);
        const electrocardiograms = await ecgModel.retrieveAllWithoutData();
        let result = await ecgModel.retrieveECGReadings(electrocardiograms[0].dataHash);
        expect(result.readings.length).to.be.equal(100);
        while (result.nextFrom) {
            result = await ecgModel.retrieveECGReadings(
                electrocardiograms[0].dataHash,
                result.nextFrom
            );
            expect(result.readings.length).to.be.equal(result.nextFrom ? 100 : 99);
        }
    }).timeout(4000);
});
