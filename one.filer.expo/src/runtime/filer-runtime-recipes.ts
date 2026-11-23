import RecipesStable from '@refinio/one.models/lib/recipes/recipes-stable.js';
import RecipesExperimental from '@refinio/one.models/lib/recipes/recipes-experimental.js';
import {
    ReverseMapsStable,
    ReverseMapsForIdObjectsStable
} from '@refinio/one.models/lib/recipes/reversemaps-stable.js';
import {
    ReverseMapsExperimental,
    ReverseMapsForIdObjectsExperimental
} from '@refinio/one.models/lib/recipes/reversemaps-experimental.js';
import GlueContentRecipes from '@glueone/glue.core/recipes/GlueContentRecipes.js';
import PresenceRecipes from '@glueone/glue.core/recipes/PresenceRecipes.js';
import GlueAuthorityRecipes from '@glueone/glue.core/recipes/GlueAuthorityRecipes.js';
import GlueInstanceAuthorizationRecipes from '@glueone/glue.core/recipes/GlueInstanceAuthorization.js';
import {ConnectionPhoneBookRecipes} from '@refinio/connection.core/recipes';
import {
    AssemblyCoreRecipes,
    AssemblyCoreReverseMaps,
    AssemblyReleaseHistoryDeclarations
} from '@refinio/assembly.core/recipes';
import {DeviceCoreRecipes, DeviceCoreReverseMaps} from '@refinio/device.core/recipes/index.js';
import {SettingsRecipes} from '@refinio/settings.core/recipes/index.js';
import {filerHostRecipes, filerHostReverseMaps} from '@refinio/filer.expo/host';

function mergeReverseMaps(...groups: Iterable<[string, Set<string>]>[]): Map<string, Set<string>> {
    const merged = new Map<string, Set<string>>();
    for (const group of groups) {
        for (const [type, fields] of group) {
            const existing = merged.get(type);
            if (existing) {
                for (const field of fields) existing.add(field);
            } else {
                merged.set(type, new Set(fields));
            }
        }
    }
    return merged;
}

export function getFilerRuntimeRecipes(): unknown[] {
    const recipeGroups: Array<{name: string; recipes: unknown[]}> = [
        {name: 'one.models/stable', recipes: RecipesStable as unknown[]},
        {name: 'one.models/experimental', recipes: RecipesExperimental as unknown[]},
        {name: 'glue.core/content', recipes: GlueContentRecipes as unknown[]},
        {name: 'glue.core/presence', recipes: PresenceRecipes as unknown[]},
        {name: 'glue.core/authority', recipes: GlueAuthorityRecipes as unknown[]},
        {name: 'glue.core/instance-authorization', recipes: GlueInstanceAuthorizationRecipes as unknown[]},
        {name: 'connection.core/phonebook', recipes: ConnectionPhoneBookRecipes as unknown[]},
        {name: 'assembly.core', recipes: AssemblyCoreRecipes as unknown[]},
        {name: 'device.core', recipes: DeviceCoreRecipes as unknown[]},
        {name: 'settings.core', recipes: SettingsRecipes as unknown[]},
        {name: 'filer.expo/host', recipes: filerHostRecipes as unknown[]}
    ];

    const recipes: unknown[] = [];
    for (const group of recipeGroups) {
        if (!Array.isArray(group.recipes)) {
            throw new Error(`[Filer] Recipe group ${group.name} is not an array`);
        }
        group.recipes.forEach((recipe, index) => {
            if (recipe === undefined) {
                throw new Error(`[Filer] Recipe ${group.name}[${index}] is undefined`);
            }
            if (recipe === null || typeof recipe !== 'object') {
                throw new Error(`[Filer] Recipe ${group.name}[${index}] is not an object`);
            }
            const entry = recipe as { $type$?: unknown; name?: unknown; rule?: unknown };
            if (entry.$type$ !== 'Recipe') {
                throw new Error(`[Filer] Recipe ${group.name}[${index}] has invalid $type$`);
            }
            if (typeof entry.name !== 'string' || entry.name.length === 0) {
                throw new Error(`[Filer] Recipe ${group.name}[${index}] has invalid name`);
            }
            if (!Array.isArray(entry.rule)) {
                throw new Error(`[Filer] Recipe ${group.name}[${index}] (${entry.name}) has invalid rule`);
            }
            recipes.push(recipe);
        });
    }

    const nameCounts = new Map<string, number>();
    for (const recipe of recipes) {
        const name = (recipe as {name: string}).name;
        nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    const duplicates = [...nameCounts.entries()].filter(([, count]) => count > 1);
    if (duplicates.length > 0) {
        throw new Error(`[Filer] Duplicate recipes detected: ${duplicates.map(([name]) => name).join(', ')}`);
    }
    return recipes;
}

export function getFilerRuntimeReverseMaps(): Map<string, Set<string>> {
    return mergeReverseMaps(
        ReverseMapsStable,
        ReverseMapsExperimental,
        DeviceCoreReverseMaps as unknown as Iterable<[string, Set<string>]>,
        AssemblyCoreReverseMaps as unknown as Iterable<[string, Set<string>]>,
        filerHostReverseMaps as unknown as Iterable<[string, Set<string>]>
    );
}

export function getFilerRuntimeReverseMapsForIdObjects(): Map<string, Set<string>> {
    return mergeReverseMaps(
        ReverseMapsForIdObjectsStable,
        ReverseMapsForIdObjectsExperimental
    );
}

export function getFilerHistoryDeclarations(): readonly unknown[] {
    return AssemblyReleaseHistoryDeclarations.filter(
        declaration => declaration.objectType !== 'ReleaseState'
    );
}
