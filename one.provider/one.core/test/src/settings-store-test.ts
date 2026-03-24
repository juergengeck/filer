/* eslint-disable no-await-in-loop */
import {expect} from 'chai';

import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import {SettingsStore} from '../../lib/system/settings-store.js';

import * as StorageTestInit from './_helpers.js';

describe('Misc - KeyValueStorage', () => {
    before(async () => {
        await StorageTestInit.init();
    });

    after(async () => {
        await closeAndDeleteCurrentInstance();
    });

    it('Should setItem() & getItem()', async () => {
        await SettingsStore.setItem('test$first-key', 'test$first-value');
        expect(await SettingsStore.getItem('test$first-key')).to.equal('test$first-value');
    });

    it('Should setItem()', async () => {
        await SettingsStore.setItem('test$key', 'test$value');
        expect(await SettingsStore.getItem('test$key')).to.equal('test$value');
    });

    it('Should removeItem()', async () => {
        await SettingsStore.removeItem('test$key');
        expect(await SettingsStore.getItem('test$key')).to.equal(undefined);
    });

    it('Should overwrite first item', async () => {
        await SettingsStore.setItem('test$first-key', 'test$new-value');
        expect(await SettingsStore.getItem('test$first-key')).to.equal('test$new-value');
    });

    it('Should write json as value', async () => {
        await SettingsStore.setItem(
            'test$second-key',
            JSON.stringify({testStr: 'test', testNum: 2})
        );
        expect(await SettingsStore.getItem('test$second-key')).to.equal(
            '{"testStr":"test","testNum":2}'
        );
    });

    it('Should write object as value', async () => {
        await SettingsStore.setItem('test$second-key', {testStr: 'test', testNum: 2});
        expect(await SettingsStore.getItem('test$second-key')).to.deep.equal({
            testStr: 'test',
            testNum: 2
        });
    });

    it('Should overwrite previous key and write list as value', async () => {
        await SettingsStore.setItem('test$second-key', JSON.stringify([1, 2, 3, 4, 5, 6]));
        expect(await SettingsStore.getItem('test$second-key')).to.equal('[1,2,3,4,5,6]');
    });

    it('Should add 20 items and retrieve the key of the last one', async () => {
        for (let i = 0; i < 20; i++) {
            await SettingsStore.setItem(`key#${i}`, JSON.stringify(i));
            expect(await SettingsStore.getItem(`key#${i}`)).to.equal(JSON.stringify(i));
        }
    });
});
