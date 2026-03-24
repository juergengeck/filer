import type {BLOB, Recipe, RecipeRule} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

/**
 * @global
 * Starting point in the persisted file system. Points to a root entry.
 */
export interface PersistentFileSystemRoot {
    $type$: 'PersistentFileSystemRoot';
    root: PersistentFileSystemRootEntry;
}

/**
 * @global
 * Directory entry structure for the Persisted File System Directory (What the directory contains)
 */
export interface PersistentFileSystemDirectoryEntry {
    mode: number;
    content: SHA256Hash<PersistentFileSystemDirectory | PersistentFileSystemFile>;
}

/**
 * @global
 * Part of the PersistentFileSystemRoot that preservers the root's mode and his reference
 */
export interface PersistentFileSystemRootEntry {
    mode: number;
    entry: SHA256Hash<PersistentFileSystemDirectory>;
}

/**
 * @global
 * Persisted file system file structure
 */
export interface PersistentFileSystemFile {
    $type$: 'PersistentFileSystemFile';
    content: SHA256Hash<BLOB>;
}

export interface PersistentFileSystemChild {
    mode: number;
    path: string;
    content: SHA256Hash<PersistentFileSystemDirectory | PersistentFileSystemFile>;
}

/**
 * @global
 * Persisted file system directory structure
 */
export interface PersistentFileSystemDirectory {
    $type$: 'PersistentFileSystemDirectory';
    children: PersistentFileSystemChild[];
}

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        PersistentFileSystemDirectory: PersistentFileSystemDirectory;
        PersistentFileSystemFile: PersistentFileSystemFile;
        PersistentFileSystemRoot: PersistentFileSystemRoot;
    }
}
/**
 * the main root directory that points to a FileSystemDirectory and his mode
 * @type {({valueType: string, itemprop: string} | {referenceToObj: Set<string>, itemprop: string})[]}
 */
export const PersistentFileSystemRootEntryRule: RecipeRule[] = [
    {
        itemprop: 'mode',
        itemtype: {type: 'number'}
    },
    {
        itemprop: 'entry',
        itemtype: {
            type: 'referenceToObj',
            allowedTypes: new Set(['PersistentFileSystemDirectory'])
        }
    }
];

export const PersistentFileSystemChildrenListRule: RecipeRule[] = [
    {
        itemprop: 'path',
        itemtype: {type: 'string'}
    },
    {
        itemprop: 'mode',
        itemtype: {type: 'number'}
    },
    {
        itemprop: 'content',
        itemtype: {
            type: 'referenceToObj',
            allowedTypes: new Set(['PersistentFileSystemDirectory', 'PersistentFileSystemFile'])
        }
    }
];

/**
 * used to represent BLOBs
 * @type {{name: string, rule: {referenceToBlob: boolean, itemprop: string}[], $type$: string}}
 */
export const PersistentFileSystemFileRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'PersistentFileSystemFile',
    rule: [
        {
            itemprop: 'content',
            itemtype: {
                type: 'referenceToBlob'
            }
        }
    ]
};

/**
 * the children field is Map<string, FileSystemDirectoryEntry> where string is the simple path e.g '/dir1' in the current directory
 * @type {{name: string, rule: {valueType: string, itemprop: string}[], $type$: string}}
 */
export const PersistentFileSystemDirectoryRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'PersistentFileSystemDirectory',
    rule: [
        {
            itemprop: 'children',
            itemtype: {
                type: 'bag',
                item: {
                    type: 'object',
                    rules: PersistentFileSystemChildrenListRule
                }
            }
        }
    ]
};

/**
 * the main data structure for the root entry
 * @type {{name: string, rule: {rule: RecipeRule[], itemprop: string}[], $type$: string}}
 */
export const PersistentFileSystemRootRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'PersistentFileSystemRoot',
    rule: [
        {
            itemprop: 'root',
            itemtype: {
                type: 'object',
                rules: PersistentFileSystemRootEntryRule
            }
        }
    ]
};

const PersistentFileSystemRecipes: Recipe[] = [
    PersistentFileSystemDirectoryRecipe,
    PersistentFileSystemFileRecipe,
    PersistentFileSystemRootRecipe
];

export default PersistentFileSystemRecipes;
