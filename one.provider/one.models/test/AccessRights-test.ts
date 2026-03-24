/**
 * @author Sebastian Șandru <sebastian@refinio.net>
 */

import {expect} from 'chai';

import {closeAndDeleteCurrentInstance} from '@refinio/one.core/lib/instance.js';
import {
    getObjectByIdObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';

import type AccessModel from '../lib/models/AccessModel.js';

import * as StorageTestInit from './_helpers.js';
import TestModel from './utils/TestModel.js';

let accessModel: AccessModel;
let testModel: TestModel;

describe('AccessRights model test', () => {
    before(async () => {
        await StorageTestInit.init();
        const model = new TestModel('ws://localhost:8000');
        await model.init(undefined);
        testModel = model;
        accessModel = model.accessModel;
    });

    after(async () => {
        await testModel.shutdown();
        await closeAndDeleteCurrentInstance();
    });

    it('should see if the access groups were created on init', async () => {
        await accessModel.createAccessGroup('partners');
        await accessModel.createAccessGroup('clinic');

        const partnerGroup = await accessModel.getAccessGroupByName('partners');
        const clinicGroup = await accessModel.getAccessGroupByName('clinic');
        expect(partnerGroup).to.not.be.undefined;
        expect(clinicGroup).to.not.be.undefined;
    });

    it('should get a group by name', async () => {
        const partnerGroup = await accessModel.getAccessGroupByName('partners');
        const clinicGroup = await accessModel.getAccessGroupByName('clinic');
        expect(partnerGroup).to.not.be.undefined;
        expect(clinicGroup).to.not.be.undefined;
        try {
            await accessModel.getAccessGroupByName('undefined');
        } catch (e) {
            expect(e).to.be.not.undefined;
        }
    });

    it('should add person to an access group', async () => {
        const newPerson = await storeVersionedObject({
            $type$: 'Person',
            email: 'foo@refinio.net'
        });
        await accessModel.addPersonToAccessGroup('partners', newPerson.idHash);
        const partnerGroup = await accessModel.getAccessGroupByName('partners');
        expect(partnerGroup.obj.person[0]).to.be.equal(newPerson.idHash);
    });

    it('should add an existing person to an access group', async () => {
        const newPerson = await storeVersionedObject({
            $type$: 'Person',
            email: 'foo@refinio.net'
        });
        await accessModel.addPersonToAccessGroup('partners', newPerson.idHash);
        const partnerGroup = await accessModel.getAccessGroupByName('partners');
        expect(partnerGroup.obj.person.length).to.be.equal(1);
    });

    it('should delete a person from an access group', async () => {
        const person = await getObjectByIdObj({$type$: 'Person', email: 'foo@refinio.net'});
        await accessModel.removePersonFromAccessGroup('partners', person.idHash);
        const partnerGroup = await accessModel.getAccessGroupByName('partners');
        expect(partnerGroup.obj.person).to.have.length(0);
    });

    it('should delete a fake person from an access group', async () => {
        const newPerson = await storeVersionedObject({
            $type$: 'Person',
            email: 'foo111@refinio.net'
        });
        await accessModel.removePersonFromAccessGroup('partners', newPerson.idHash);
        const partnerGroup = await accessModel.getAccessGroupByName('partners');
        expect(partnerGroup.obj.person).to.have.length(0);
    });

    it('should list persons for an access group', async () => {
        const newPerson = await storeVersionedObject({
            $type$: 'Person',
            email: 'foo@refinio.net'
        });
        await accessModel.addPersonToAccessGroup('partners', newPerson.idHash);
        const persons = await accessModel.getAccessGroupPersons('partners');
        expect(persons).to.have.length(1);
    });
});
