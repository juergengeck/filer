/* eslint-disable no-await-in-loop */

import {expect} from 'chai';

import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import * as MicrodataToIdHash from '../../lib/microdata-to-id-hash.js';
import * as ObjectToMicrodata from '../../lib/object-to-microdata.js';
import type {Instance, Person, Recipe} from '../../lib/recipes.js';
import type {UnversionedObjectResult} from '../../lib/storage-unversioned-objects.js';
import {storeUnversionedObject} from '../../lib/storage-unversioned-objects.js';
import type {VersionedObjectResult} from '../../lib/storage-versioned-objects.js';
import {storeVersionedObject} from '../../lib/storage-versioned-objects.js';
import {readUTF8TextFile} from '../../lib/system/storage-base.js';
import * as ObjectUtils from '../../lib/util/object.js';
import type {SHA256Hash} from '../../lib/util/type-checks.js';

import * as StorageTestInit from './_helpers.js';
import type {
    OneTest$Email,
    OneTest$IdPropNestedNames,
    OneTest$TestMapId,
    OneTest$TestUnversioned,
    OneTest$TestVersioned,
    OneTest$TestVersionedOptional,
    OneTest$VersionedReferenceTest
} from './_register-types.js';

async function createTestObjects(): Promise<
    [
        VersionedObjectResult<Person>,
        VersionedObjectResult<Person>,
        VersionedObjectResult<Person>,
        VersionedObjectResult<OneTest$Email>,
        VersionedObjectResult<Instance>,
        VersionedObjectResult<OneTest$TestMapId>,
        VersionedObjectResult<OneTest$TestVersioned>,
        VersionedObjectResult<OneTest$TestVersioned>,
        VersionedObjectResult<OneTest$VersionedReferenceTest>,
        VersionedObjectResult<OneTest$IdPropNestedNames>,
        VersionedObjectResult<OneTest$IdPropNestedNames>,
        VersionedObjectResult<OneTest$TestVersionedOptional>,
        VersionedObjectResult<OneTest$TestVersionedOptional>,
        VersionedObjectResult<OneTest$TestVersionedOptional>,
        VersionedObjectResult<OneTest$TestVersionedOptional>,
        UnversionedObjectResult<OneTest$TestUnversioned>
    ]
> {
    const p1 = await storeVersionedObject({
        $type$: 'Person',
        email: 'Asomeone@somewhere.org'
    });
    const p2 = await storeVersionedObject({
        $type$: 'Person',
        email: 'Bsomeother@someother.com'
    });
    const p3 = await storeVersionedObject({
        $type$: 'Person',
        email: 'Cyetanother@somewhereelse.com'
    });

    const v1 = await storeVersionedObject({
        $type$: 'OneTest$Email',
        messageID: 'dummy-123.123@dummy.com',
        from: [p1.idHash],
        to: [p2.idHash, p3.idHash],
        subject: 'Dummy email',
        date: 1438418318011
    });

    // This object has an ID property that is a reference
    const v2 = await storeVersionedObject({
        $type$: 'Instance',
        name: 'Instance Name',
        owner: p1.idHash,
        recipe: new Set() as Set<SHA256Hash<Recipe>>,
        enabledReverseMapTypes: new Map(),
        enabledReverseMapTypesForIdObjects: new Map()
    });

    // Tests an id property that is an array
    const v3 = await storeVersionedObject({
        $type$: 'OneTest$TestMapId',
        id: new Map([
            ['id item 1', 'value 1'],
            ['id item 2', 'value 2'],
            ['id item 3', 'value 3']
        ]),
        data: ['item 1', 'item 2', 'item 3']
    });

    // Tests an id property that is an array (bag of values actually)
    const v4 = await storeVersionedObject({
        $type$: 'OneTest$TestVersioned',
        id: ['id item 1', 'id item 2', 'id item 3'],
        data: ['item 1', 'item 2', 'item 3']
    });

    // Tests an id property that is missing (recipe says it's optional)
    const v5 = await storeVersionedObject({
        $type$: 'OneTest$TestVersioned',
        data: ['item 1', 'item 2', 'item 3']
    });

    const r1 = await storeVersionedObject({
        $type$: 'OneTest$VersionedReferenceTest',
        name: 'Test',
        versionedRef: [p1.hash, p2.hash, p3.hash]
    });

    const nestedIdPropName1 = await storeVersionedObject({
        $type$: 'OneTest$IdPropNestedNames',
        propertyName: ['something', 'something two'],
        otherName: 'something else',
        nested: [
            {
                nestedItem: 'foo',
                propertyName: 'name1'
            }
        ],
        thirdIdProp: ['nothing', 'more nothing']
    });

    const nestedIdPropName2 = await storeVersionedObject({
        $type$: 'OneTest$IdPropNestedNames',
        propertyName: ['something'], // Only one item!
        otherName: 'something else',
        nested: [
            {
                nestedItem: 'foo',
                propertyName: 'name1'
            }
        ],
        thirdIdProp: ['nothing']
    });

    // THE LAST OBJECT is an unversioned object (causes error, the test relies on this position)
    const u1 = await storeUnversionedObject({
        $type$: 'OneTest$TestUnversioned',
        data: ['Lorem ipsum...']
    });

    const optVersioned1 = await storeVersionedObject({
        $type$: 'OneTest$TestVersionedOptional',
        id1: 'dummy'
    });

    const optVersioned2 = await storeVersionedObject({
        $type$: 'OneTest$TestVersionedOptional',
        id2: 'dummy'
    });

    const optVersioned3 = await storeVersionedObject({
        $type$: 'OneTest$TestVersionedOptional',
        id1: 'dummy1',
        id2: 'dummy2'
    });

    const optVersioned4 = await storeVersionedObject({
        $type$: 'OneTest$TestVersionedOptional'
    });

    return [
        p1,
        p2,
        p3,
        v1,
        v2,
        v3,
        v4,
        v5,
        r1,
        nestedIdPropName1,
        nestedIdPropName2,
        optVersioned1,
        optVersioned2,
        optVersioned3,
        optVersioned4,
        u1
    ];
}

describe('Microdata to ID-hash tests', () => {
    let testObjs: [
        VersionedObjectResult<Person>,
        VersionedObjectResult<Person>,
        VersionedObjectResult<Person>,
        VersionedObjectResult<OneTest$Email>,
        VersionedObjectResult<Instance>,
        VersionedObjectResult<OneTest$TestMapId>,
        VersionedObjectResult<OneTest$TestVersioned>,
        VersionedObjectResult<OneTest$TestVersioned>,
        VersionedObjectResult<OneTest$VersionedReferenceTest>,
        VersionedObjectResult<OneTest$IdPropNestedNames>,
        VersionedObjectResult<OneTest$IdPropNestedNames>,
        VersionedObjectResult<OneTest$TestVersionedOptional>,
        VersionedObjectResult<OneTest$TestVersionedOptional>,
        VersionedObjectResult<OneTest$TestVersionedOptional>,
        VersionedObjectResult<OneTest$TestVersionedOptional>,
        UnversionedObjectResult<OneTest$TestUnversioned>
    ];

    before(async () => {
        await StorageTestInit.init();
        testObjs = await createTestObjects();
    });

    after(async () => {
        await closeAndDeleteCurrentInstance();
    });

    it('should extract ID object', async () => {
        for (let i = 0; i < testObjs.length - 1; i++) {
            const id = testObjs[i].idHash;

            if (id === undefined) {
                continue;
            }

            const microdata = await readUTF8TextFile(testObjs[i].hash);
            const actualIdMicrodata = ObjectToMicrodata.convertObjToIdMicrodata(testObjs[i].obj);
            const calculatzedIdMicrodata = MicrodataToIdHash.extractIdObject(microdata);

            expect(actualIdMicrodata).to.equal(calculatzedIdMicrodata);
        }
    });

    it('should convert object microdata to ID representation and calculate the ID hash', async () => {
        const idHashOrig = [];
        const idHashToTest = [];

        for (let i = 0; i < testObjs.length - 1; i++) {
            if (testObjs[i].idHash === undefined) {
                // Only test the versioned test  objects
                continue;
            }

            // WE CANNOT USE testObjs[i].idHash - storeVersionedObject uses the function being
            // tested!
            idHashOrig[i] = await ObjectUtils.calculateIdHashOfObj(testObjs[i].obj as any);

            // These are the hashes from the tested module
            idHashToTest[i] = await MicrodataToIdHash.calculateIdHashForStoredObj(
                testObjs[i].hash as SHA256Hash<any>
            );

            expect(idHashOrig[i]).to.equal(idHashToTest[i]);
        }
    });

    it('should return undefined for unversioned objects', async () => {
        const idHash1 = await MicrodataToIdHash.calculateIdHashForStoredObj(
            testObjs[testObjs.length - 1].hash as SHA256Hash<any>
        );
        expect(idHash1).to.be.undefined;
    });

    it('should throw an error when used on imploded objects', () => {
        const imploded = [
            '<div itemscope itemtype="//refin.io/OneTest$IdPropIsReference">',
            // 1st ID property: must be ReferenceToId
            '<span itemprop="id1" itemscope itemtype="//refin.io/Person">',
            '<span itemprop="email">Asomeone@somewhere.org</span>',
            '</div>',
            // // 2nd ID property: okay TODO See recipe, property is disabled
            // '<span itemprop="id2">',
            // '<a itemprop="inner" data-type="id"
            // 'cc369a0746bc141dbeb90ea34e3ffb106037bdc8f72c48393572b799361af184', '</a>',
            // '</span>',
            '<span itemprop="data">Random data</span>',
            '<span itemprop="data">More random data</span>',
            '</div>'
        ].join('');

        // The last test object is an unversioned one
        try {
            MicrodataToIdHash.extractIdObject(imploded);
            expect(false, 'Function should have thrown an error').to.be.true;
        } catch (error) {
            expect(error, error).to.be.instanceof(Error);
            expect(error.message).to.include('M2IH-XID1: Did not find ID property "id1"');
        }
    });
});
