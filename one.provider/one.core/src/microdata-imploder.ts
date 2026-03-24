/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

/**
 * Type of the values returned by module
 * {@link microdata-imploder.module:ts|microdata-imploder}'s `findAllReferenceHashes` function.
 * @typedef {object} ImploderSectionWithReference
 * @property {number} start
 * @property {number} end
 * @property {HashLinkTypeNames} hashLinkType
 * @property {SHA256Hash|SHA256IdHash} reference
 */
interface ImploderSectionWithReference {
    start: number;
    end: number;
    hash: SHA256Hash | SHA256IdHash;
    hashLinkType: HashLinkTypeNames;
}

/**
 * Follow-up type after {@link ImploderSectionWithReference} sections have been processed and
 * the respective referenced objects loaded
 * @private
 * @typedef {object} ImploderSectionWithMicrodata
 * @property {number} start
 * @property {number} end
 * @property {string} microdata
 */
interface ImploderSectionWithMicrodata {
    start: number;
    end: number;
    microdata: string;
}

/**
 * @private
 * @typedef {function(string,object[],HashLinkTypeNames):Promise<string>} GetFileFn
 */
type GetFileFn = (
    rule: RecipeRule,
    reference: SHA256Hash | SHA256IdHash,
    hashLinkType: HashLinkTypeNames
) => Promise<string>;

/**
 * @private
 * @typedef {function(string,ImploderSectionWithReference[]):Promise<string>} MapFn
 */
type MapFn = (
    itemprop: string,
    values: ImploderSectionWithReference[]
) => Promise<ImploderSectionWithMicrodata[]>;

import {createError} from './errors.js';
import {parseHeader} from './microdata-to-object.js';
import {getRecipe} from './object-recipes.js';
import type {HashLinkTypeNames} from './object-to-microdata.js';
import {escapeForHtml, HashLinkType} from './object-to-microdata.js';
import type {BLOB, HashTypes, OneObjectTypeNames, RecipeRule} from './recipes.js';
import {readBlobAsBase64} from './storage-blob.js';
import {getIdHash} from './storage-id-hash-cache.js';
import {getCurrentVersionNode} from './storage-versioned-objects.js';
import {readUTF8TextFile} from './system/storage-base.js';
import type {ArrayValueMap} from './util/function.js';
import {createArrayValueMap} from './util/function.js';
import {MICRODATA_START} from './util/object.js';
import {isString} from './util/type-checks-basic.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';
import {isHash} from './util/type-checks.js';

/**
 * In a given string of microdata it finds all hashes in properties created by hash link recipe
 * rules (links to objects, ID objects, CLOBs or BLOBs). It parses a ONE object microdata string
 * and for each hash link yields the positions of the first and last character of the Reference
 * object's microdata inside the string as well as the Javascript object representation of the
 * Reference object.
 *
 * The full tag to find - and to replace - is
 *
 * ```
 * <a itemprop="${propertyName}" data-type="${linkType}" href="${hash}">${hash}</a>
 * ```
 * @static
 * @param {string} microdata
 * @returns {Map<string, ImploderSectionWithReference[]>} Returns a Map with "itemprop"
 * strings as key and arrays of {@link ImploderSectionWithReference} objects as values - one for
 * each Reference object it finds after applying the optional "properties" (inclusive) filter
 */
export function findAllReferenceHashes(
    microdata: string
): ArrayValueMap<string, ImploderSectionWithReference> {
    const returns = createArrayValueMap<string, ImploderSectionWithReference>();

    // Character search position within "microdata".
    let position = 0;

    // When indexOf() does not find the search string it is our indication that there are no
    // more included ONE microdata objects ahead.
    // noinspection AssignmentResultUsedJS
    while ((position = microdata.indexOf('<a ', position)) > -1) {
        const start = position;
        let dataTypeBegin = position;
        let itemprop = '';
        let sanityCheckFrom = 0;
        let sanityCheckSubStrLen = 0;
        let hashLinkBegin = 0;

        // <a itemprop="${propertyName}" data-type="${linkType}" href="${hash}">${hash}</a>
        //              ^ <= this position
        if (microdata.startsWith('itemprop="', position + '<a '.length)) {
            // 3 from '<a ', 10 from 'itemprop="'
            dataTypeBegin += 13;
            itemprop = microdata.substring(dataTypeBegin, microdata.indexOf('"', dataTypeBegin));
            sanityCheckFrom = dataTypeBegin + itemprop.length + '" '.length;
            sanityCheckSubStrLen = 'data-type="'.length;

            hashLinkBegin = dataTypeBegin + itemprop.length + '" '.length + sanityCheckSubStrLen;
        } else {
            dataTypeBegin += 3;

            // we will find the upper tag with the itemprop
            const isolatedMicrodata = microdata.substring(0, dataTypeBegin);
            itemprop = isolatedMicrodata.substring(
                isolatedMicrodata.lastIndexOf('itemprop="') + 10,
                microdata.indexOf('"', isolatedMicrodata.lastIndexOf('itemprop="') + 10)
            );
            sanityCheckFrom = dataTypeBegin;
            sanityCheckSubStrLen = 'data-type="'.length;
            hashLinkBegin = dataTypeBegin + sanityCheckSubStrLen;
        }

        // <a itemprop="${propertyName}" data-type="${linkType}" href="${hash}">${hash}</a>
        //              ^^^^^^^^^^^^^^^ <= substring

        // Sanity check: match the next fixed part of the string. OPTIONAL - this could be moved
        // behind a flag for "development" builds, any data created with one.core should never
        // trigger an error.
        if (
            microdata.slice(sanityCheckFrom, sanityCheckFrom + sanityCheckSubStrLen) !==
            'data-type="'
        ) {
            throw createError('MIMP-FRH1', {
                itemprop,
                position: dataTypeBegin + itemprop.length,
                microdata
            });
        }

        // <a itemprop="${propertyName}" data-type="${linkType}" href="${hash}">${hash}</a>
        //                                          ^ <= this position

        // <a itemprop="${propertyName}" data-type="${linkType}" href="${hash}">${hash}</a>
        //                                          ^^^^^^^^^^^ <= substring
        const hashLinkType = microdata.substring(
            hashLinkBegin,
            microdata.indexOf('"', hashLinkBegin)
        ) as HashLinkTypeNames;

        // FROM HERE ON ALL LENGTHS ARE FIXED

        // DESIGN DECISION: Find the hash in the href attribute not in the data, like all other
        // values.
        // <a itemprop="${propertyName}" data-type="${linkType}" href="${hash}">${hash}</a>
        //                                                             ^ <= this position
        const hashStart = hashLinkBegin + hashLinkType.length + '">'.length; // + 8; // +8 for '"
        // href="'

        // <a itemprop="${propertyName}" data-type="${linkType}" href="${hash}">${hash}</a>
        //                                                             ^^^^^^^ <= substring
        const hash = microdata.slice(hashStart, hashStart + 64) as SHA256Hash | SHA256IdHash;

        if (!isHash(hash)) {
            throw createError('MIMP-FRH5', {itemprop, position: hashStart, microdata});
        }

        // <a itemprop="${propertyName}" data-type="${linkType}" href="${hash}">${hash}</a>
        //                                                                                 ^
        //                                                                  this position  °
        // Offset from href-attribute hash string start:
        // 2 ('">') + 64 (hash) + 4 (</a>) = 134
        position = hashStart + 68;

        returns.add(itemprop, {
            start,
            end: position,
            hash,
            hashLinkType
        });
    }

    return returns;
}

/**
 * References to ID objects need to be resolved into a concrete version of the object. If the
 * caller does not specify their own ID reference resolution callback we use this function and
 * get the hash of the latest version of the object.
 * @private
 * @param {SHA256IdHash} idHash
 * @returns {Promise<SHA256Hash>}
 */
async function defaultReferenceToIdCallback(idHash: SHA256IdHash): Promise<SHA256Hash> {
    return (await getCurrentVersionNode(idHash)).obj.data;
}

/**
 * Creates an asynchronous  function that given an `itemprop` string and a Reference object
 * loads the referenced object's microdata and inserts the itemprop string in the surrounding
 * top-level span tag in preparation of insertion of this object to take the place of the
 * reference object in the parent object.
 * @private
 * @param {function(SHA256Hash):SHA256Hash} idReferenceCallback
 * @returns {function(string,Reference):Promise<?string>}
 */
function createGetFile(
    idReferenceCallback: (idHash: SHA256IdHash) => SHA256Hash | Promise<SHA256Hash>
): GetFileFn {
    return async function getFile(
        rule: RecipeRule,
        reference: SHA256Hash | SHA256IdHash,
        hashLinkType: HashLinkTypeNames
    ): Promise<string> {
        let microdata = '';
        // If it is an ID reference one concrete version has to be chosen
        const hash =
            hashLinkType === 'id'
                ? await idReferenceCallback(reference as SHA256IdHash)
                : (reference as SHA256Hash<HashTypes>);

        if (hashLinkType === HashLinkType.OBJ || hashLinkType === HashLinkType.ID) {
            // Recursion: implode the included object itself before including it
            const data = await implodeMicrodata(await readUTF8TextFile(hash), idReferenceCallback);
            const idHash = hashLinkType === HashLinkType.ID ? await getIdHash(hash) : undefined;

            // INJECT the "itemprop" and also attribute(s) with the Reference hash
            // attribute of the property with the reference. This changes the opening tag of
            // the included ONE object microdata from
            //   <div itemscope itemType="//refin.io/TYPE">...
            // to
            //   <span itemprop="ITEMPROP" data-hash="..." itemScope
            // itemType="//refin.io/TYPE">...
            microdata =
                `<span itemprop="${rule.itemprop}" data-hash="${hash}"` +
                (idHash ? ` data-id-hash="${idHash}">` : '>') +
                data +
                '</span>';
        } else if (hashLinkType === HashLinkType.CLOB) {
            microdata =
                `<span itemprop="${rule.itemprop}" data-hash="${hash}">` +
                escapeForHtml(await readUTF8TextFile(hash)) +
                '</span>';
        } else if (hashLinkType === HashLinkType.BLOB) {
            microdata =
                `<span itemprop="${rule.itemprop}" data-hash="${hash}">` +
                (await readBlobAsBase64(hash as SHA256Hash<BLOB>)) +
                '</span>';
        } else {
            throw createError('MIMP-GF10', {itemprop: rule.itemprop, reference});
        }

        return microdata;
    };
}

function findRuleInType(rule: RecipeRule[], itemprop: string): RecipeRule | undefined {
    let result: RecipeRule | undefined = undefined;

    function getEachItem(object: RecipeRule[]): RecipeRule | undefined {
        object.forEach(item => {
            searchItem(item);
        });

        return result;
    }

    function searchItem(item: {[key: string]: any}): void {
        Object.keys(item).forEach(key => {
            if (typeof item[key] === 'object') {
                searchItem(item[key]);
            }

            if (key === 'rules') {
                result = (item[key] as RecipeRule[]).find(
                    innerRule => innerRule.itemprop === itemprop
                );
            }
        });
    }

    return getEachItem(rule);
}

/**
 * Recursively find a rule in a recipe rules array. Recursion is used for nested object rules,
 * when a rule contains another rules array.
 * @private
 * @param {RecipeRule[]} rules
 * @param {string} itemprop
 * @returns {RecipeRule | void}
 */
function findRuleByItemprop(rules: RecipeRule[], itemprop: string): RecipeRule | void {
    for (const rule of rules) {
        if (rule.itemprop === itemprop) {
            return rule;
        }
    }
}

/**
 * Creates an asynchronous  function to map an included Reference object to the referenced object's
 * microdata string
 * @private
 * @param {string} objType
 * @param {function(string,Reference):Promise<string>} getFile
 * @returns {function(string,ImploderSectionWithReference[]):ImploderSectionWithMicrodata}
 */
function createMapFn(objType: OneObjectTypeNames, getFile: GetFileFn): MapFn {
    return async function map(itemprop, values) {
        const recipe = getRecipe(objType);

        const rule =
            findRuleByItemprop(recipe.rule, itemprop) ?? findRuleInType(recipe.rule, itemprop);

        if (rule === undefined) {
            throw createError('MIMP-MAPF1', {itemprop, recipe});
        }

        return Promise.all(
            values.map(async value => {
                return {
                    start: value.start,
                    end: value.end,
                    microdata: await getFile(rule, value.hash, value.hashLinkType)
                };
            })
        );
    };
}

/**
 * Takes microdata and returns microdata: Receives a ONE microdata object with (crypto-hash)
 * references to other ONE microdata objects. It gets the referenced ONE microdata objects
 * and replaces the references with the actual objects' microdata. It returns this version of
 * the original ONE microdata object that now includes all referenced objects inside itself.
 * Because it uses RECURSION and the recursion is based on returning microdata while the API for
 * implode() is based on receiving and returning a hash this recursible part is its own function.
 * @private
 * @param {string} microdata - ONE microdata object
 * @param {function(SHA256Hash):SHA256Hash} idReferenceCallback
 * @returns {Promise<string>} Resolves with the imploded ONE microdata object
 */
async function implodeMicrodata(
    microdata: string,
    idReferenceCallback: (idHash: SHA256IdHash) => SHA256Hash | Promise<SHA256Hash>
): Promise<string> {
    if (!isString(microdata) || !microdata.startsWith(MICRODATA_START)) {
        throw createError('MIMP-IMPL1');
    }

    // Key: itemprop (string) of an included Reference object
    // Value: location of the Reference object
    const refs = findAllReferenceHashes(microdata);

    const type = parseHeader(undefined, {
        html: microdata,
        isIdObj: false,
        position: 0
    });

    const getFile = createGetFile(idReferenceCallback);
    const mapFn = createMapFn(type, getFile);

    const loadedRefs = await refs.mapAsync(mapFn);

    let imploadedMicrodata = '';
    let lastPosition = 0;

    loadedRefs.forEach(o => {
        o.forEach(oo => {
            imploadedMicrodata += microdata.substring(lastPosition, oo.start);
            imploadedMicrodata += oo.microdata;
            lastPosition = oo.end;
        });
    });

    imploadedMicrodata += microdata.substring(lastPosition);
    return imploadedMicrodata;
}

/**
 * Reads a ONE microdata file identified by its crypto-hash and recursively replaces all
 * references to other ONE objects by those objects themselves. The result is a single
 * ONE object microdata string that contains the original object and all its references.
 *
 * The imploded object is not written to storage! If the object is a versioned object It would
 * become the latest version of the object before implosion (same Object-ID, so it would just
 * add a new entry Object map). Imploded microdata is not meant to be stored but for whatever
 * processing and external communication an app wants to perform.
 * @static
 * @async
 * @param {SHA256Hash} hash - SHA-256 hash of a ONE microdata object in storage
 * @param {function(SHA256Hash):SHA256Hash} [idReferenceCallback]
 * @returns {Promise<string>} Resolves with the imploded ONE object as a microdata string. It will
 * be the same as the input object's microdata if no ONE objects are referenced in that object or if
 * the options filtered out the existing references.
 */
export async function implode(
    hash: SHA256Hash,
    idReferenceCallback: (
        idHash: SHA256IdHash
    ) => SHA256Hash | Promise<SHA256Hash> = defaultReferenceToIdCallback
): Promise<string> {
    const microdata = await readUTF8TextFile(hash);
    return await implodeMicrodata(microdata, idReferenceCallback);
}
