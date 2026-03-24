/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * A ONE internal module to optimize the calculation of ID hashes from microdata without going
 * through a to-Javascript-object conversion.
 * @module
 */

import type {OneVersionedObjectInterfaces} from '@OneObjectInterfaces';

import {createError} from './errors.js';
import type {ParseContext} from './microdata-to-object.js';
import {findClosingTag, parseHeader} from './microdata-to-object.js';
import {getRecipe, isVersionedObjectType, resolveRuleInheritance} from './object-recipes.js';
import {getHashLinkTypeFromRule} from './object-to-microdata.js';
import type {OneObjectTypeNames, OneVersionedObjectTypeNames} from './recipes.js';
import {createCryptoHash} from './system/crypto-helpers.js';
import {readUTF8TextFile} from './system/storage-base.js';
import {ID_OBJECT_ATTR} from './util/object.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';

const ITEMPROP_START = '<span itemprop="';
const ITEMPROP_END = '</span>';

const REF_ITEMPROP_START = '<a itemprop="';
const REF_ITEMPROP_END = '</a>';

const ORDERED_ARRAY_ITEMPROP_START = '<ol itemprop="';
const ORDERED_ARRAY_ITEMPROP_END = '</ol>';

const UNORDERED_ARRAY_ITEMPROP_START = '<ul itemprop="';
const UNORDERED_ARRAY_ITEMPROP_END = '</ul>';

const MAP_ITEMPROP_START = '<dl itemprop="';
const MAP_ITEMPROP_END = '</dl>';

/**
 * This function takes a ONE object in microdata format, parses the type, and if it is a versioned
 * object builds the ID object microdata by extracting the ID properties into a new string and
 * adding the ID object attribute to the outer span.
 *
 * Assumption (enforced in type-checks.js function `ensureRecipeRuleObj`): all ID properties are
 * on the top level, never inside nested objects. Reminder: nested objects are part of the
 * object, unlike included objects, which have their own recipe, and which even when included in
 * imploded form don't influence the ID object of the parent, since they cannot be ID properties
 * (disallowed through the mentioned type-checks.js function).
 * @static
 * @param {string} microdata - The full microdata string
 * @param {(OneObjectTypeNames|OneObjectTypeNames[])} [expectedType] - An optional expected
 * type or an array of expected type names. If it is not matched by the microdata leads to an
 * `Error` when attempting to parse the microdata. Leaving this parameter undefined or
 * setting it to '*' disables the type check.
 * @returns {(undefined|string)} Returns the ONE object microdata string of the ID object or
 * `undefined` if the object is not a versioned object and no ID object can be built
 */
export function extractIdObject<T extends OneObjectTypeNames>(
    microdata: string,
    expectedType: T | '*' | T[] = '*'
): void | string {
    const parseContext: ParseContext = {
        html: microdata,
        isIdObj: false,
        position: 0
    };

    // This throws an error if there is no valid ONE microdata header (the rest is ignored)
    const type = parseHeader(
        new Set(Array.isArray(expectedType) ? expectedType : [expectedType]),
        parseContext
    );

    if (!isVersionedObjectType(type)) {
        return;
    }

    const recipe = getRecipe(type);

    // Outer ONE object <span> tag with the type information. Make it ID-object microdata by
    // inserting the virtual (never found in storage) attribute used to make hashes of ID
    // objects different from hashes of regular objects with (coincidentally) only ID properties
    let idMicrodata = `<div ${ID_OBJECT_ATTR} ${microdata.substring(5, parseContext.position)}`;

    let firstTagStart = parseContext.position;

    for (const rule of recipe.rule) {
        const actualRule = resolveRuleInheritance(rule);
        const usesLinkTag = actualRule.itemtype
            ? getHashLinkTypeFromRule(actualRule.itemtype.type) !== undefined
            : false;

        // Not "actualRule" but "rule" - inherited isId is ignored, ID properties must be
        // defined in the actual recipe and cannot be inherited.
        if (rule.isId) {
            // The match string we can use must end at the itemprop name boundary and nothing
            // more. That is because Reference and ReferenceToId objects can be ID properties,
            // and they have a full outer span tag including "itemscope" and "itemtype", which
            // itemprop <span> tags that are just regular values do not have.
            // The search string therefore is: '<span itemprop="..."'
            let itempropStart = '';
            let itempropEnd = '';
            const valueType = rule.itemtype ? rule.itemtype : {type: 'string'};

            if (valueType.type === 'bag' || valueType.type === 'set') {
                itempropStart = UNORDERED_ARRAY_ITEMPROP_START;
                itempropEnd = UNORDERED_ARRAY_ITEMPROP_END;
            } else if (valueType.type === 'array') {
                itempropStart = ORDERED_ARRAY_ITEMPROP_START;
                itempropEnd = ORDERED_ARRAY_ITEMPROP_END;
            } else if (valueType.type === 'map') {
                itempropStart = MAP_ITEMPROP_START;
                itempropEnd = MAP_ITEMPROP_END;
            } else if (usesLinkTag) {
                itempropStart = REF_ITEMPROP_START;
                itempropEnd = REF_ITEMPROP_END;
            } else {
                itempropStart = ITEMPROP_START;
                itempropEnd = ITEMPROP_END;
            }

            const matchStr = itempropStart + actualRule.itemprop + '"';

            // Two cases: The current itemprop holds...
            //  - a single value
            //  - an array of values
            // In case 1 the tag we find as a start and its corresponding end tag are all we
            // need. If we have an array there possibly are many (but at least one) such tag. If
            // we look for the last one the area between the first and the last are all values
            // for this same itemprop, due to how ONE microdata is created.
            // ID properties can be included objects like "Reference" ONE objects, which means
            // there are <span> tags nested inside the opening and closing <span> tags. Our
            // algorithm does not need special treatment to find either one since findEndTag()
            // counts opening and closing tags (presuming correct ONE object microdata).

            const foundPos = microdata.indexOf(matchStr, firstTagStart);

            if (foundPos === -1) {
                if (rule.optional === true) {
                    continue;
                }

                // ID properties are "must have" and never optional.
                throw createError('M2IH-XID1', {itemprop: actualRule.itemprop, microdata});
            }

            firstTagStart = foundPos;

            // About 2nd parameter:
            // We have to advance the starting position past the "<" of the current <span ...> tag
            // because that is what findClosingTag() searches for. How far we go (without going past
            // the end of the current tag!) is a matter of "nano-optimization", +1 is the minimum.
            // We skip the match string which still is safe.
            const endTagPosition = findClosingTag(microdata, firstTagStart + matchStr.length);

            // <span itemprop="idPropertyA"...>.....</span> (one or many concatenated)
            // substring()'s second parameter is the index of the first character to EXCLUDE from
            // the returned substring.
            idMicrodata += microdata.substring(firstTagStart, endTagPosition + itempropEnd.length);
        }
    }

    return idMicrodata + '</div>';
}

/**
 * The function calculates the ID hash for a given hash. If the object is not a versioned
 * object `undefined` is returned.
 *
 * This method performs no validity checks on the microdata. It presumes that the microdata
 * represents a valid ONE object.
 *
 * However, if the header itself cannot be parsed an Error is thrown. An error is also thrown if
 * for a detected opening <span> tag no matching closing tag can be found, and an `Error` is
 * thrown if there is an `expectedType` parameter and the type found in the header is not a match.
 * @static
 * @async
 * @param {SHA256Hash} hash
 * @param {(OneVersionedObjectTypeNames|OneVersionedObjectTypeNames[]|'*')} [expectedType='*'] - An
 * optional expected type or an array of expected type names. If it is not matched by the
 * microdata leads to an `Error` when attempting to parse the microdata. Leaving this parameter
 * undefined or setting it to '*' disables the type check.
 * @returns {Promise<undefined|SHA256Hash>} Returns undefined if the hash points to an
 * unversioned object, or the SHA-256 of the ID object of the object identified by the given
 * hash if it is a versioned object.
 */
export async function calculateIdHashForStoredObj<T extends OneVersionedObjectTypeNames>(
    hash: SHA256Hash<OneVersionedObjectInterfaces[T]>,
    expectedType: T | '*' | T[] = '*'
): Promise<undefined | SHA256IdHash<OneVersionedObjectInterfaces[T]>> {
    const microdata = await readUTF8TextFile(hash);

    if (microdata.startsWith(`<div ${ID_OBJECT_ATTR}`)) {
        return hash as unknown as SHA256IdHash<OneVersionedObjectInterfaces[T]>;
    }

    const idObjectMicrodata = extractIdObject(microdata, expectedType);

    if (idObjectMicrodata === undefined) {
        // Unversioned object type
        return;
    }

    return (await createCryptoHash(idObjectMicrodata)) as unknown as SHA256IdHash<
        OneVersionedObjectInterfaces[T]
    >;
}
