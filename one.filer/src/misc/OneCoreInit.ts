/**
 * This file provides functions that help you to create or open a one.core instance.
 *
 * Those functions store some information you usually need to log in to an instance in
 * local storage (browser) / key value file (node). This way the user doesn't have to specify such
 * information. This is especially useful if such information is random. The user does not want
 * to input random data.
 *
 * At the moment the person email and instance names are random unless you explicitly specify it
 * in the identity file on instance creation.
 */
import {closeInstance, initInstance} from '@refinio/one.core/lib/instance';
import {SettingsStore} from '@refinio/one.core/lib/system/settings-store';
import {setBaseDirOrName} from '@refinio/one.core/lib/system/storage-base';
import {isString} from '@refinio/one.core/lib/util/type-checks-basic';
import {convertIdentityToInstanceOptions} from '@refinio/one.models/lib/misc/IdentityExchange';
import type {IdentityWithSecrets} from '@refinio/one.models/lib/misc/IdentityExchange';
import RecipesExperimental from '@refinio/one.models/lib/recipes/recipes-experimental';
import RecipesStable from '@refinio/one.models/lib/recipes/recipes-stable';
import {
    ReverseMapsForIdObjectsStable,
    ReverseMapsStable
} from '@refinio/one.models/lib/recipes/reversemaps-stable';
import {
    ReverseMapsExperimental,
    ReverseMapsForIdObjectsExperimental
} from '@refinio/one.models/lib/recipes/reversemaps-experimental';
import {COLOR} from '@refinio/one.core/lib/logger';
import {createRandomString} from '@refinio/one.core/lib/system/crypto-helpers';

/**
 * Initializes one.core.
 *
 * @param secret - The secret used to encrypt stuff - like private keys.
 * @param directory - The storage directory of one.core
 * @param identity - An identity file that is used to initialize a new one.core instance. If an
 * instance already exists and you specify an identity file the initialization will fail. If a
 * new one.core instance is created and you don't specify an identity, a completely random
 * identity is created.
 */
export async function initOneCoreInstance(
    secret: string,
    directory: string,
    identity?: IdentityWithSecrets
): Promise<void> {
    setBaseDirOrName(directory);

    const storedInstanceName = await SettingsStore.getItem('instance');
    const storedEmail = await SettingsStore.getItem('email');

    let instanceOptions;

    if (identity) {
        if (isString(storedInstanceName) && isString(storedEmail)) {
            console.log(
                `${COLOR.FG_RED}Error: An instance already exists. You cannot pass an identity file to initOneCoreInstance.${COLOR.OFF}`
            );
            process.exit(1);
        } else {
            instanceOptions = convertIdentityToInstanceOptions(identity, secret);
        }
    } else if (isString(storedInstanceName) && isString(storedEmail)) {
        instanceOptions = {
            name: storedInstanceName,
            email: storedEmail,
            secret
        };
    } else {
        instanceOptions = {
            name: `rnd-${await createRandomString(32)}`,
            email: `rnd.generated@${await createRandomString(32)}.com`,
            secret
        };
    }

    try {
        await initInstance({
            ...instanceOptions,
            directory: directory,
            initialRecipes: [...RecipesStable, ...RecipesExperimental],
            initiallyEnabledReverseMapTypes: new Map([
                ...ReverseMapsStable,
                ...ReverseMapsExperimental
            ]),
            initiallyEnabledReverseMapTypesForIdObjects: new Map([
                ...ReverseMapsForIdObjectsStable,
                ...ReverseMapsForIdObjectsExperimental
            ])
        });

        if (!isString(storedInstanceName) || !isString(storedEmail)) {
            await SettingsStore.setItem('instance', instanceOptions.name);
            await SettingsStore.setItem('email', instanceOptions.email);
        }
    } catch (e) {
        // See https://github.com/refinio/one.core/blob/master/test/storage-base-test.ts#L977
        if ((e as NodeJS.ErrnoException).code === 'CYENC-SYMDEC') {
            console.log(`${COLOR.FG_RED}Error: invalid password${COLOR.OFF}`);
            process.exit(1);
        } else {
            throw new Error((e as Error).message);
        }
    }
}

/**
 * Closes the one.core instance.
 */
export function shutdownOneCoreInstance(): void {
    closeInstance();
}

/**
 * Checks if the one.core instance exists by checking the Settings Store (Local storage on
 * browser or key value file on node)
 * @param directory
 */
export async function oneCoreInstanceExists(directory: string): Promise<boolean> {
    setBaseDirOrName(directory);

    const storedInstanceName = await SettingsStore.getItem('instance');
    const storedEmail = await SettingsStore.getItem('email');

    return isString(storedInstanceName) && isString(storedEmail);
}

/**
 * Retrieves the person email and instance name from local storage / key value file.
 *
 * Throws if no instance exists.
 *
 * @param directory
 */
export async function oneCoreInstanceInformation(
    directory: string
): Promise<{personEmail: string; instanceName: string}> {
    setBaseDirOrName(directory);

    const personEmail = await SettingsStore.getItem('instance');
    const instanceName = await SettingsStore.getItem('email');

    if (!isString(personEmail) || !isString(instanceName)) {
        throw new Error('No one.core instance exists.');
    }

    return {
        personEmail,
        instanceName
    };
}
