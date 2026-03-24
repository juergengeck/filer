/**
 * @author Sebastian Șandru <sebastian@refinio.net>
 */

import type {
    Access,
    Group,
    IdAccess,
    OneObjectTypes,
    Person
} from '@refinio/one.core/lib/recipes.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {OEvent} from '../misc/OEvent.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {Model} from './Model.js';
import type {VersionedObjectResult} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {
    getObjectByIdObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';

const ACCESS_LOCKS = {
    GROUP_LOCK: 'GROUP_LOCK'
} as const;

/**
 * @deprecated
 * @description Access Model class
 * @augments EventEmitter
 */
export default class AccessModel extends Model {
    /**
     * Event is emitted when:
     * - a access group is created
     * - persons are added to the access group
     * - persons are removed from the access group
     */
    public onGroupsUpdated = new OEvent<() => void>();

    constructor() {
        super();
    }

    async init() {
        this.state.assertCurrentState('Uninitialised');
        this.state.triggerEvent('init');
    }

    async shutdown(): Promise<void> {
        this.state.triggerEvent('shutdown');
    }

    /**
     *
     * @param groupName
     * @returns
     */
    async getAccessGroupPersons(groupName: string | string[]): Promise<SHA256IdHash<Person>[]> {
        this.state.assertCurrentState('Initialised');
        return await serializeWithType(ACCESS_LOCKS.GROUP_LOCK, async () => {
            if (Array.isArray(groupName)) {
                return [
                    ...new Set(
                        (
                            await Promise.all(
                                groupName.map(async group => {
                                    const groupObj = await this.getAccessGroupByName(group);
                                    return groupObj === undefined ? [] : groupObj.obj.person;
                                })
                            )
                        ).reduce((acc, curr) => acc.concat(curr), [])
                    )
                ];
            } else {
                const group = await this.getAccessGroupByName(groupName);
                return group === undefined ? [] : group.obj.person;
            }
        });
    }

    /**
     *
     * @param name
     * @param personId
     */
    async removePersonFromAccessGroup(name: string, personId: SHA256IdHash<Person>): Promise<void> {
        this.state.assertCurrentState('Initialised');

        const group = await this.getAccessGroupByName(name);
        /** add the person only if it does not exist and prevent unnecessary one updates **/

        const foundIndex = group.obj.person.findIndex(
            (accPersonIdHash: SHA256IdHash<Person>) => accPersonIdHash === personId
        );
        if (foundIndex !== undefined) {
            group.obj.person.splice(foundIndex, 1);
            await storeVersionedObject(group.obj);
            this.onGroupsUpdated.emit();
        }
    }

    /**
     * @param name
     * @param personId
     */
    async addPersonToAccessGroup(name: string, personId: SHA256IdHash<Person>): Promise<void> {
        this.state.assertCurrentState('Initialised');

        return await serializeWithType(ACCESS_LOCKS.GROUP_LOCK, async () => {
            const group = await this.getAccessGroupByName(name);
            /** add the person only if it does not exist and prevent unnecessary one updates **/
            if (
                group.obj.person.find(
                    (accPersonIdHash: SHA256IdHash<Person>) => accPersonIdHash === personId
                ) === undefined
            ) {
                group.obj.person.push(personId);
                await storeVersionedObject(group.obj);

                this.onGroupsUpdated.emit();
            }
        });
    }

    async giveGroupAccessToObject(
        groupName: string,
        objectHash: SHA256Hash<OneObjectTypes>
    ): Promise<VersionedObjectResult<Access | IdAccess>> {
        this.state.assertCurrentState('Initialised');

        const group = await this.getAccessGroupByName(groupName);
        const [accResult] = await createAccess([
            {
                object: objectHash,
                person: [],
                group: [group.idHash],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        return accResult;
    }

    /**
     *
     * @param name
     * @returns
     */
    async getAccessGroupByName(name: string): Promise<VersionedObjectResult<Group>> {
        this.state.assertCurrentState('Initialised');

        return await getObjectByIdObj({$type$: 'Group', name: name});
    }

    /**
     *
     * @param name
     */
    async createAccessGroup(name: string): Promise<void> {
        this.state.assertCurrentState('Initialised');

        try {
            await getObjectByIdObj({$type$: 'Group', name: name});
        } catch (ignored) {
            await storeVersionedObject({
                $type$: 'Group',
                name: name,
                person: []
            });
            this.onGroupsUpdated.emit();
        }
    }
}
