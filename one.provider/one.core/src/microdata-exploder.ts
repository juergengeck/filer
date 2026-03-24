/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

/* ***********************************************************************************************
 *
 * THIS MODULE IS ALMOST EXACTLY THE SAME AS microdata-to-object.js
 *
 * Main difference: all functions are asynchronous, and this is why I did not try to extract a
 * common core. As they are written right now they are pretty clear, if I try to handle both
 * synchronous and synchronous cases, or try to extract the tiny part that remains common, it
 * becomes a mess.
 *
 * Other differences:
 * - parseObject() replaces all included objects with a reference object (ID, versioned or
 *   unversioned reference depending on rule.referenceToObj or rule.referenceToId) after saving
 *   them as separate object
 * - "WriteStorage" is passed through to all functions. Only parseObject() needs it, but it is
 *   called from another function and calls another function which calls that other function...
 *   in order to keep the code as similar as possible to microdata-to-object I simply pass it
 *   through rather than doing something more fancy since it requires the smallest code changes.
 * - Parsing of the outer span tag of included objects ("inner header") needs to also parse tag
 *   attributes data-hash="..." and the optional data-id-hash="...", which only exist on
 *   imploded microdata.
 *
 * So, no "DRI" until somebody can figure out a better way - *that doesn't create less readable
 * code*.
 *
 *
 * SPEED INEFFICIENCY
 *
 * Also, to keep the code as much the same as possible to the one in microdata-to-object to not
 * make it harder to find common ground, we keep the sequential processing. However, we could
 * change the parsing to go ahead after spawning an asynchronous task and then end up having
 * several of them running in parallel, e.g. while parsing an array of values. That was useless
 * and undesirable in the purely synchronous parser because it does not save anything there, but
 * here we have to wait for included objects to be saved that could benefit from parallelization.
 *
 * ********************************************************************************************* */

/* eslint-disable no-await-in-loop */

type TypeAndHashAndIdHash = [OneObjectTypeNames, SHA256Hash, undefined | SHA256IdHash];

import {createError} from './errors.js';
import type {ParseContext} from './microdata-to-object.js';
import {
    breakMicrodataIntoArray,
    CONVERSION_FUNCTIONS,
    extractMicrodataWithTag,
    findClosingTag,
    unescapeFromHtml
} from './microdata-to-object.js';
import {
    ensureValidTypeName,
    getRecipe,
    isVersionedObject,
    resolveRuleInheritance
} from './object-recipes.js';
import type {HashLinkTypeNames} from './object-to-microdata.js';
import {HashLinkType} from './object-to-microdata.js';
import type {
    BagValue,
    MapValue,
    ObjectValue,
    OneObjectTypeNames,
    OneObjectTypes,
    RecipeRule,
    ValueType
} from './recipes.js';
import type {AnyObjectCreation} from './storage-base-common.js';
import {storeUTF8Clob} from './storage-blob.js';
import {storeUnversionedObject} from './storage-unversioned-objects.js';
import {storeVersionedObject} from './storage-versioned-objects.js';
import {createFileWriteStream} from './system/storage-streams.js';
import {substrForceMemCopy} from './util/string.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';
import {ensureHash, ensureIdHash} from './util/type-checks.js';

const EXTRACT_FUNCTIONS = {
    primitive: extractPrimitiveTypeFromMicrodata,
    unorderedCollection: extractUnorderedListTypeFromMicrodata,
    orderedCollection: extractOrderedListTypeFromMicrodata,
    map: extractMapTypeFromMicrodata,
    obj: extractObjectTypeFromMicrodata
} as const;

const SPAN_END = '</span>';
const DIV_END = '</div>';

/**
 * Extracts any primitive type from the given microdata. {@link PrimitiveValueTypes}
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule.itemprop} rule
 * @param {boolean} isNested
 * @returns {unknown}
 */
function extractPrimitiveTypeFromMicrodata(
    CONTEXT: ParseContext,
    rule: RecipeRule,
    isNested: boolean = false
): unknown {
    // if the given type is a nested one, the value exists by itself, without span tags
    if (isNested) {
        return CONTEXT.html;
    }

    const startStr = `<span itemprop="${rule.itemprop}">`;
    const startStrLen = startStr.length;

    if (!CONTEXT.html.startsWith(startStr, CONTEXT.position)) {
        return undefined;
    }

    const valueStart = CONTEXT.position + startStrLen;
    const valueEnd = CONTEXT.html.indexOf('<', valueStart);

    const valueStr = substrForceMemCopy(CONTEXT.html, valueStart, valueEnd - valueStart);
    CONTEXT.position += startStrLen + valueStr.length + SPAN_END.length;

    return valueStr;
}

/**
 * Extracts an ordered list from the given microdata.
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule} rule
 * @param {StringValue | IntegerValue | NumberValue | BooleanValue | StringifiableValue |
 *     ReferenceToObjValue | ReferenceToIdValue | ReferenceToClobValue | ReferenceToBlobValue |
 *     MapValue | BagValue | ArrayValue | SetValue | ObjectValue} itemType
 * @param {boolean} isNested
 * @returns {unknown[] | undefined}
 */
async function extractOrderedListTypeFromMicrodata(
    CONTEXT: ParseContext,
    rule: RecipeRule,
    itemType: ValueType,
    isNested: boolean = false
): Promise<unknown[] | undefined> {
    let startStr;

    if (isNested) {
        startStr = '<ol>';
    } else {
        startStr = `<ol itemprop="${rule.itemprop}">`;
    }

    const endStr = '</ol>';
    const startStrLen = startStr.length;

    if (CONTEXT.html.startsWith(startStr + endStr)) {
        CONTEXT.position += (startStr + endStr).length;
        return [];
    }

    if (!CONTEXT.html.startsWith(startStr, CONTEXT.position)) {
        return undefined;
    }

    const closingTagPosition = findClosingTag(CONTEXT.html, CONTEXT.position + startStrLen);

    const extractedValues = breakMicrodataIntoArray(
        CONTEXT.html,
        '<li>',
        '</li>',
        CONTEXT.position + startStrLen,
        closingTagPosition
    );

    CONTEXT.position = closingTagPosition + endStr.length;

    return await Promise.all(
        extractedValues.map(async li => {
            return await parseMicrodataByTheExpectedType(
                itemType,
                rule,
                // isolated CONTEXT
                {
                    ...CONTEXT,
                    position: 0,
                    html: li
                }
            );
        })
    );
}

/**
 * Extracts map object from the given microdata.
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule.itemprop} rule
 * @param {MapValue} valueType
 * @param {boolean} isNested
 * @returns {Map<unknown, unknown>}
 */
async function extractMapTypeFromMicrodata(
    CONTEXT: ParseContext,
    rule: RecipeRule,
    valueType: MapValue,
    isNested: boolean = false
): Promise<Promise<Map<unknown, unknown>> | undefined> {
    let startStr;

    if (isNested) {
        startStr = '<dl>';
    } else {
        startStr = `<dl itemprop="${rule.itemprop}">`;
    }

    const endStr = '</dl>';
    const startStrLen = startStr.length;

    if (CONTEXT.html.startsWith(startStr + endStr, CONTEXT.position)) {
        CONTEXT.position += (startStr + endStr).length;
        return new Map();
    }

    if (!CONTEXT.html.startsWith(startStr, CONTEXT.position)) {
        return undefined;
    }

    const endTagPosition = findClosingTag(CONTEXT.html, CONTEXT.position + startStrLen);

    const unWrappedMicrodata = CONTEXT.html.slice(CONTEXT.position + startStrLen, endTagPosition);

    const extractedValues = [];
    let newStartPos = 0;

    while (newStartPos < unWrappedMicrodata.length) {
        const newEndPosition = findClosingTag(unWrappedMicrodata, newStartPos + '<dt>'.length);
        extractedValues.push(unWrappedMicrodata.slice(newStartPos + '<dt>'.length, newEndPosition));
        newStartPos = newEndPosition + '</dt>'.length;
    }

    CONTEXT.position = endTagPosition + endStr.length;

    const valueMap = new Map();

    // policy: map's microdata always has one value as the key and one value as the map's value
    for (let i = 0; i < extractedValues.length; i += 2) {
        const key = await parseMicrodataByTheExpectedType(
            valueType.key,
            rule,
            // isolated CONTEXT
            {
                ...CONTEXT,
                position: 0,
                html: extractedValues[i]
            }
        );

        const value = await parseMicrodataByTheExpectedType(
            valueType.value,
            rule,
            // isolated CONTEXT
            {
                ...CONTEXT,
                position: 0,
                html: extractedValues[i + 1]
            }
        );

        valueMap.set(key, value);
    }

    return valueMap;
}

/**
 * Extracts an unordered list from the given microdata.
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule} rule
 * @param {StringValue | IntegerValue | NumberValue | BooleanValue | StringifiableValue |
 *     ReferenceToObjValue | ReferenceToIdValue | ReferenceToClobValue | ReferenceToBlobValue |
 *     MapValue | BagValue | ArrayValue | SetValue | ObjectValue} itemType
 * @param {boolean} isNested
 * @returns {unknown[] | undefined}
 */
async function extractUnorderedListTypeFromMicrodata(
    CONTEXT: ParseContext,
    rule: RecipeRule,
    itemType: BagValue['item'],
    isNested: boolean = false
): Promise<unknown[] | undefined> {
    let startStr;

    if (isNested) {
        startStr = '<ul>';
    } else {
        startStr = `<ul itemprop="${rule.itemprop}">`;
    }

    const endStr = '</ul>';
    const startStrLen = startStr.length;

    if (CONTEXT.html.startsWith(startStr + endStr)) {
        CONTEXT.position += (startStr + endStr).length;
        return [];
    }

    if (!CONTEXT.html.startsWith(startStr, CONTEXT.position)) {
        return undefined;
    }

    const endTagPosition = findClosingTag(CONTEXT.html, CONTEXT.position + startStrLen);

    const extractedValues = breakMicrodataIntoArray(
        CONTEXT.html,
        '<li>',
        '</li>',
        CONTEXT.position + startStrLen,
        endTagPosition
    );

    CONTEXT.position = endTagPosition + endStr.length;

    return await Promise.all(
        extractedValues.map(async li => {
            return await parseMicrodataByTheExpectedType(
                itemType,
                rule,
                // isolated CONTEXT
                {
                    ...CONTEXT,
                    position: 0,
                    html: li
                }
            );
        })
    );
}

/**
 * Extracts an object from the given microdata.
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule} rule
 * @param {ObjectValue} valueType
 * @returns {unknown}
 */
async function extractObjectTypeFromMicrodata(
    CONTEXT: ParseContext,
    rule: RecipeRule,
    valueType: ObjectValue
): Promise<unknown> {
    let startStr;
    let endStr;

    if (CONTEXT.html.startsWith(`<div itemprop="${rule.itemprop}">`, CONTEXT.position)) {
        // if its standalone object, it has itemprop
        startStr = `<div itemprop="${rule.itemprop}">`;
        endStr = '</div>';
    } else {
        startStr = '<div>';
        endStr = '</div>';
    }

    const startStrLen = startStr.length;

    if (CONTEXT.html.startsWith(startStr + endStr, CONTEXT.position)) {
        return {};
    }

    if (!CONTEXT.html.startsWith(startStr, CONTEXT.position)) {
        return undefined;
    }

    const endTagPosition = findClosingTag(CONTEXT.html, CONTEXT.position + startStrLen);

    const unWrappedMicrodata = CONTEXT.html.slice(CONTEXT.position + startStrLen, endTagPosition);

    const extractedValues = [];
    let newStartPos = 0;

    while (newStartPos < unWrappedMicrodata.length) {
        const newEndPosition = extractMicrodataWithTag(unWrappedMicrodata, newStartPos);
        extractedValues.push(unWrappedMicrodata.slice(newEndPosition.start, newEndPosition.end));
        newStartPos = newEndPosition.end;
    }

    const obj: {[key: string]: unknown} = {};

    // NOTE: No check for missing non-optional properties necessary, because the exploder saves
    // each object, and that means any missing mandatory  values will be detected then anyway!

    await Promise.all(
        extractedValues.map(async microdata => {
            for (const objectRule of valueType.rules) {
                if (
                    microdata.startsWith(
                        `itemprop="${objectRule.itemprop}"`,
                        microdata.indexOf('itemprop')
                    )
                ) {
                    obj[objectRule.itemprop] = await parseMicrodataByTheExpectedType(
                        objectRule.itemtype,
                        objectRule,
                        // isolated CONTEXT
                        {
                            ...CONTEXT,
                            position: 0,
                            html: microdata
                        },
                        false
                    );

                    break;
                }
            }
        })
    );

    CONTEXT.position = endTagPosition + endStr.length;

    return obj;
}

/**
 * This is the opening tag of included CLOB and BLOB (base64 encoded) files. 64 is the hash
 * string length; the itemprop string length, here left empty, also needs to be
 * added ro get the full length.
 * @private
 * @type {number}
 */
const BLOB_START_LENGTH = '<span itemprop="" data-hash="">'.length + 64;

/**
 * Parses the base64 encoded string in an imploded ReferenceToBlob <span> tag and saves the BLOB.
 * @private
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule} rule
 * @returns {Promise<*>}
 */
async function parseInnerBlob(CONTEXT: ParseContext, rule: RecipeRule): Promise<unknown> {
    if (
        !CONTEXT.html
            .slice(CONTEXT.position)
            .startsWith('<span itemprop="' + rule.itemprop + '" data-hash=')
    ) {
        return undefined;
    }

    const start = CONTEXT.position + BLOB_START_LENGTH + rule.itemprop.length;
    const end = CONTEXT.html.indexOf('<', start);

    const stream = createFileWriteStream('base64');

    stream.write(CONTEXT.html.slice(start, end));
    await stream.end();

    const writeResult = await stream.promise;
    CONTEXT.position = end + 7; // '</span>'.length
    return writeResult.hash;
}

/**
 * Parses the HTML-escaped string in an imploded ReferenceToClob <span> tag and saves the
 * UTF-8 CLOB.
 * @private
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule} rule
 * @returns {Promise<*>}
 */
async function parseInnerClob(CONTEXT: ParseContext, rule: RecipeRule): Promise<unknown> {
    if (
        !CONTEXT.html
            .slice(CONTEXT.position)
            .startsWith('<span itemprop="' + rule.itemprop + '" data-hash=')
    ) {
        return undefined;
    }

    const start = CONTEXT.position + BLOB_START_LENGTH + rule.itemprop.length;
    const end = CONTEXT.html.indexOf('<', start);

    const writeResult = await storeUTF8Clob(unescapeFromHtml(CONTEXT.html.slice(start, end)));
    CONTEXT.position = end + 7; // '</span>'.length

    return writeResult.hash;
}

/**
 * @async
 * @param {ValueType} valueType
 * @param {RecipeRule} rule
 * @param {ParseContext} CONTEXT
 * @param {boolean} isNested
 * @returns {unknown}
 */
async function parseMicrodataByTheExpectedType(
    valueType: ValueType = {type: 'string'},
    rule: RecipeRule,
    CONTEXT: ParseContext,
    isNested: boolean = false
): Promise<unknown> {
    switch (valueType.type) {
        case 'string': {
            const valueStr = EXTRACT_FUNCTIONS.primitive(CONTEXT, rule, isNested);

            // This _must_ be a string value or somebody managed to sneak an impossible recipe
            // by our Recipe type check. In type-check's ensureRecipeRule() we ensure that a RegExp
            // can only be set for string properties, but we still check if it is a string because
            // the static type checker does not understand that larger context. Plus, extra safety.
            if (
                valueStr !== undefined &&
                valueType.regexp &&
                !new RegExp(
                    CONVERSION_FUNCTIONS.regexp(valueType.regexp as unknown as string)
                ).test(valueStr as string)
            ) {
                throw createError('M2O-PV3', {
                    value: valueStr,
                    regexp: CONVERSION_FUNCTIONS.regexp(valueType.regexp as unknown as string)
                });
            }

            return valueStr
                ? CONVERSION_FUNCTIONS[valueType.type ?? 'string'](valueStr as string)
                : valueStr;
        }
        case 'integer':
        case 'number':
        case 'boolean':
        case 'stringifiable': {
            const valueStr = EXTRACT_FUNCTIONS.primitive(CONTEXT, rule, isNested);

            return valueStr
                ? CONVERSION_FUNCTIONS[valueType.type ?? 'string'](valueStr as string)
                : valueStr;
        }
        case 'referenceToObj': {
            return await parseInnerObject(CONTEXT, valueType.allowedTypes, rule, HashLinkType.OBJ);
        }
        case 'referenceToId': {
            return await parseInnerObject(CONTEXT, valueType.allowedTypes, rule, HashLinkType.ID);
        }
        case 'referenceToClob': {
            return await parseInnerClob(CONTEXT, rule);
        }
        case 'referenceToBlob': {
            return await parseInnerBlob(CONTEXT, rule);
        }
        case 'array': {
            return await EXTRACT_FUNCTIONS.orderedCollection(
                CONTEXT,
                rule,
                valueType.item,
                isNested
            );
        }
        case 'map':
            return await EXTRACT_FUNCTIONS.map(CONTEXT, rule, valueType, isNested);
        case 'bag': {
            return await EXTRACT_FUNCTIONS.unorderedCollection(
                CONTEXT,
                rule,
                valueType.item,
                isNested
            );
        }
        case 'set': {
            const v = await EXTRACT_FUNCTIONS.unorderedCollection(
                CONTEXT,
                rule,
                valueType.item,
                isNested
            );
            return v === undefined ? undefined : new Set(v);
        }
        case 'object':
            return await EXTRACT_FUNCTIONS.obj(CONTEXT, rule, valueType);
    }
}

/**
 * Parses only the inner data part of a ONE microdata object, i.e. the outer frame opening div
 * tag has already been parsed and the HTML starting at the given position only contains tags
 * with actual data.
 * This function continues until all rules are exhausted and the last rule ended up finding no
 * matching string (i.e. no matching data value in a data tag with the expected itemprop name).
 * @private
 * @param {OneObjectTypeNames} type - The type was already found by the caller. This function
 * expects it so that it can insert it into the returned object before any data properties so
 * that in the iteration order of Javascript objects implicitly set (for non-numerical
 * properties) through insertion order it gets the first spot. This is for human readers of raw
 * data output, the code does not care.
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule[]} rules - An array of rules corresponding to all rules for a given ONE
 * object type from ONE object recipes
 * @returns {Promise<OneObjectTypes>}
 * @throws {Error}
 */
async function parseData(
    type: OneObjectTypeNames,
    CONTEXT: ParseContext,
    rules: readonly RecipeRule[]
): Promise<OneObjectTypes> {
    // The ONE object to add the parsed data to, pre-filled with the "type" property.
    // Type cast because this still needs to be filled with data properties
    const obj: Record<string, any> = {$type$: type};
    let value;

    for (const rule of rules) {
        const actualRule = resolveRuleInheritance(rule);

        value = await parseMicrodataByTheExpectedType(actualRule.itemtype, actualRule, CONTEXT);

        if (value === undefined && actualRule.optional !== true) {
            throw createError('MEX-PD1', {itemprop: actualRule.itemprop});
        }

        if (value !== undefined) {
            obj[actualRule.itemprop] = value;
        }
    }

    return obj as OneObjectTypes;
}

/**
 * @private
 * @param {ParseContext} CONTEXT
 * @param {undefined|Set<OneObjectTypeNames|"*">} [expectedType] - Expect certain type strings, or
 * '*' if we should accept any ONE object type that we have a recipe for. For included
 * sub-objects this is set to the Set object of the recipe rule, for top-level objects this is
 * set by the caller.
 * @returns {OneObjectTypeNames}
 * @throws {Error}
 */
function parseHeaderType(
    CONTEXT: ParseContext,
    expectedType: undefined | Set<OneObjectTypeNames | '*'>
): OneObjectTypeNames {
    // Find the type string: between the end of startStr and "> completing the tag
    const type = ensureValidTypeName(
        CONTEXT.html.slice(
            CONTEXT.position, // from
            CONTEXT.html.indexOf('">', CONTEXT.position) // to
        )
    );

    // Type check:
    // 1) For included sub-objects always using the Set from rule.referenceToObj
    // 2) For top-level objects only when the caller of the module-export convert function
    //    included a type string
    if (expectedType && !(expectedType.has(type) || expectedType.has('*'))) {
        throw createError('MEX-PHD1', {
            expected: Array.from(expectedType),
            type,
            html: CONTEXT.html
        });
    }

    CONTEXT.position += type.length + 2; // ">

    return type;
}

// The type is the last word in the URL value of attribute "itemtype":
// <div itemscope itemtype="//refin.io/[TYPE]">...</span>
const OUTER_HEADER_TYPE_START = '<div itemscope itemtype="//refin.io/';
const INNER_HEADER_TYPE_START = 'itemscope itemtype="//refin.io/';
const DATA_HASH_START = 'data-hash="';
const DATA_ID_HASH_START = ' data-id-hash="';

/**
 * @private
 * @param {ParseContext} CONTEXT
 * @returns {SHA256Hash}
 */
function parseHashAttribute(CONTEXT: ParseContext): SHA256Hash {
    const hashStart = CONTEXT.position + DATA_HASH_START.length;
    const hashEnd = hashStart + 64;

    if (
        !CONTEXT.html.startsWith(DATA_HASH_START, CONTEXT.position) ||
        CONTEXT.html.charAt(hashEnd) !== '"'
    ) {
        throw createError('MEX-PHA1', {position: CONTEXT.position, html: CONTEXT.html});
    }

    CONTEXT.position = hashEnd + 1; // '"'

    return ensureHash(CONTEXT.html.slice(hashStart, hashEnd));
}

/**
 * @private
 * @param {ParseContext} CONTEXT
 * @returns {(undefined | SHA256IdHash)}
 */
function parseIdHashAttribute(CONTEXT: ParseContext): undefined | SHA256IdHash {
    const hashStart = CONTEXT.position + DATA_ID_HASH_START.length;
    const hashEnd = hashStart + 64;

    if (
        !CONTEXT.html.startsWith(DATA_ID_HASH_START, CONTEXT.position) ||
        CONTEXT.html.charAt(hashEnd) !== '"'
    ) {
        return undefined;
    }

    CONTEXT.position = hashEnd + 1; // '"'

    return ensureIdHash(CONTEXT.html.slice(hashStart, hashEnd));
}

/**
 * @private
 * @param {ParseContext} CONTEXT
 * @param {Set<OneObjectTypeNames|"*">} expectedType - Expect certain type strings, or '*' if
 * we should accept any ONE object type that we have a recipe for. For included sub-objects this
 * is set to the Set object of the recipe rule, for top-level objects this is set by the caller.
 * @param {string} itemprop - This property is set for included objects assigned to a property
 * of a higher-level object.
 * @returns {(undefined | TypeAndHashAndIdHash)}
 * @throws {Error}
 */
function parseInnerHeader(
    CONTEXT: ParseContext,
    expectedType: undefined | Set<OneObjectTypeNames | '*'>,
    itemprop: string
): undefined | TypeAndHashAndIdHash {
    if (itemprop === undefined) {
        throw createError('MEX-PIH1');
    }

    // Outer <span> tag structure:
    // <span itemprop="..." data-hash="..." data-id-hash="..." itemscope
    //   itemtype="//refin.io/[TYPE]">...</span>
    const startStr = `<span itemprop="${itemprop}" `;

    if (!CONTEXT.html.startsWith(startStr, CONTEXT.position)) {
        // ...but if we expect an included object (when "itemprop" exists in the outer
        // span tag of the object) not finding an object is okay, since all properties are
        // optional (we don't check the mandatory ID-properties because A., we assume such an
        // object can't be written, and B., we return what we find and leave judgment to the
        // caller; be strict when writing data but be lenient when reading).
        return undefined;
    }

    CONTEXT.position += startStr.length;

    // Parse <span> tag attributes data-hash, data-id-hash only found in included objects. Those
    // are the values from the original Reference or ReferenceToId object, respectively.
    // However, even if there originally was a ReferenceToId object, which only has an ID hash
    // but no hash, there will be a concrete hash for the (one) actual object inserted for the
    // ID reference.
    const hash = parseHashAttribute(CONTEXT);
    const idHash = parseIdHashAttribute(CONTEXT);

    if (!CONTEXT.html.startsWith(OUTER_HEADER_TYPE_START, CONTEXT.position + 1)) {
        throw createError('MEX-PIH2', {
            expected: INNER_HEADER_TYPE_START,
            idHashEnd: CONTEXT.position,
            html: CONTEXT.html
        });
    }

    CONTEXT.position += OUTER_HEADER_TYPE_START.length + 1;

    const type = parseHeaderType(CONTEXT, expectedType);

    return [type, hash, idHash];
}

/**
 * This function only parses the opening enclosing "`itemscope`" span tag, extracts the type
 * string and optionally compares it to a given expected type, and advances the position counter
 * to the next character after the tag it was responsible for parsing.
 *
 * ### Example
 *
 * ```html
 * <div itemscope itemtype="//refin.io/Person">
 * ```
 *
 * leads to a return value of
 *
 * ```
 * {value: 'Person', position: 51}
 * ```
 *
 * **Note** that while `convertMicrodataToObject` takes a single string this function expects a
 * `Set` object to make it more flexible to accommodate `parseObject`, which also uses a `Set`
 * that it in turn receives from the recipe used to parse a *sub-*object.
 * @private
 * @param {ParseContext} CONTEXT
 * @param {Set<OneObjectTypeNames|"*">} [expectedType] - Expect certain type strings, or '*' if
 * we should accept any ONE object type that we have a recipe for. For included sub-objects this
 * is set to the Set object of the recipe rule, for top-level objects this is set by the caller.
 * @returns {OneObjectTypeNames}
 * @throws {Error}
 */
function parseHeader(
    CONTEXT: ParseContext,
    expectedType: undefined | Set<OneObjectTypeNames | '*'>
): OneObjectTypeNames {
    if (!CONTEXT.html.startsWith(OUTER_HEADER_TYPE_START, 0)) {
        // This is the outermost span tag, no excuses...
        throw createError('MEX-PH1', {html: CONTEXT.html});
    }

    CONTEXT.position += OUTER_HEADER_TYPE_START.length;

    return parseHeaderType(CONTEXT, expectedType);
}

/**
 * Parses an included ONE object inside an HTML microdata ONE object. Included objects always belong
 * to a property of their parent object. Since values on properties can be optional, and also
 * because while parsing an array of values we always eventually and expectedly run out of more
 * values (here: included ONE objects) to parse, this function may return `undefined` as value
 * when it does not find the expected object instead of throwing an error.
 *
 * Expected HTML:
 * ```
 * <span itemprop="..."...><div itemscope itemtype="//refin.io/...>...</div></span>
 * ```
 * @private
 * @param {ParseContext} CONTEXT
 * @param {Set<OneObjectTypeNames|"*">} expectedType - Expect certain type strings, or '*' if
 * we should accept any ONE object type that we have a recipe for. For included sub-objects this
 * is set to the Set object of the recipe rule, for top-level objects this is set by the caller.
 * @param {RecipeRule} [rule] - Included objects have a rule associated with the `itemprop`
 * property they are assigned to. The rule **should have inheritance already resolved** (property
 * `inheritFrom`), which should be the case because this parameter is only used by the
 * calling function parseMicrodataByTheExpectedType() which has passes its `rule` parameter through,
 * which has the same restriction/expectation.
 * @param {'obj' | 'id'} referenceTo
 * @returns {Promise<SHA256Hash | SHA256IdHash | undefined>}
 */
async function parseInnerObject(
    CONTEXT: ParseContext,
    expectedType: Set<OneObjectTypeNames | '*'>,
    rule: RecipeRule,
    referenceTo: Extract<'obj' | 'id', HashLinkTypeNames>
): Promise<SHA256Hash | SHA256IdHash | undefined> {
    const value = parseInnerHeader(CONTEXT, expectedType, rule.itemprop);

    // This happens when there is an array of included objects and the array ends, and a new
    // itemprop starts. Returning undefined and the original starting position tells the caller
    // to advance to the next item because all array items have been collected.
    if (value === undefined) {
        return undefined;
    }

    const [type, hash, idHash] = value;

    // We get the data-object of the ONE object and the position in the HTML microdata string
    // immediately after the last character of the last data item.
    const obj = await parseData(
        // "type" is sent so that it can be inserted right away to be at #1 position in the
        // "order" of properties (when iterating) defined by insertion order.
        type,
        CONTEXT,
        // New position: Immediately after the end of the outer span tag with the type, which
        // surrounds the actual data span tags.
        getRecipe(type).rule
    );

    if (!CONTEXT.html.startsWith(DIV_END, CONTEXT.position)) {
        throw createError('MEX-PIO1', {
            endStr: DIV_END,
            dataEnd: CONTEXT.position,
            html: CONTEXT.html
        });
    }

    // Advance to just after the </div> closing tag of the imploded object
    CONTEXT.position += DIV_END.length;

    // All inner objects are stored and then replaced by a reference object pointing to their
    // representation in storage.
    const result = isVersionedObject(obj)
        ? await storeVersionedObject(obj)
        : await storeUnversionedObject(obj);

    // Microdata attribute data-id-hash of the included object's outer span tag will be undefined
    // unless it was included through ReferenceToId.
    // The imploder could include the ID hash always, i.e. not just for ReferenceToId but also
    // for Reference if the referenced object is a versioned one, but that would be useless. If
    // the hash is correct there is no (non-theoretical) way that the ID hash is wrong. On the
    // other hand we always have a hash because a concrete object was sent.
    if (result.hash !== hash || (idHash !== undefined && result.idHash !== idHash)) {
        throw createError('MEX-PIO2', {hash, idHash, rHash: result.hash, rIdHash: result.idHash});
    }

    if (referenceTo === 'id' && idHash === undefined) {
        throw createError('MEX-PIO3', {type: obj.$type$});
    }

    const ref = referenceTo === 'id' ? idHash : hash;

    // Advance to the end of the </span> closing tag of the reference object property where the
    // referenced object was included (and just parsed), where normally there is just a hash
    if (CONTEXT.html.slice(CONTEXT.position, CONTEXT.position + SPAN_END.length) !== SPAN_END) {
        throw createError('MEX-PIO4', {html: CONTEXT.html, position: CONTEXT.position});
    }

    CONTEXT.position += SPAN_END.length;

    return ref;
}

/**
 * Parses a complete html object including the outer frame that contains the type. There
 * are two parts: First the opening outer span tag is parsed for the type information, then the
 * html inside the outer frame is parsed for the data. The type string is used to find the
 * rule-set to use for parsing - the order of rules determines the order data properties are
 * expected. When the function is done there should be exactly the closing span tag of the outer
 * frame left unparsed (of the current object - if this is an inner/included object).
 *
 * - parseObject() is the top-level function to parse microdata into objects, determining the type
 *   and creating the object that is going to be returned.
 * - parseData() is the next-level function, parsing all the actual data of an object. It yields
 *   the object on the "data" property of the returned object.
 *
 * **Note** that while `convertMicrodataToObject` takes a single string this function expects a
 * `Set` object because it needs to be more flexible: It uses the recipe rule's `type` property
 * which is a `Set` object.
 * @private
 * @param {ParseContext} CONTEXT
 * @param {Set<OneObjectTypeNames|"*">} expectedType - Expect certain type strings, or '*' if
 * we should accept any ONE object type that we have a recipe for. For included sub-objects this
 * is set to the Set object of the recipe rule, for top-level objects this is set by the caller.
 * @returns {Promise<AnyObjectCreation>}
 * @throws {Error}
 */
async function parseObject(
    CONTEXT: ParseContext,
    expectedType: Set<OneObjectTypeNames | '*'>
): Promise<AnyObjectCreation> {
    const type = parseHeader(CONTEXT, expectedType);

    // We get the data-object of the ONE object and the position in the HTML microdata string
    // immediately after the last character of the last data item.
    const obj = await parseData(
        // "type" is sent so that it can be inserted right away to be at #1 position in the
        // "order" of properties (when iterating) defined by insertion order.
        type,
        CONTEXT,
        getRecipe(type).rule
    );

    // When the data parsing is done we should find the end-tag next and nothing else.
    const endStr = '</div>';

    if (!CONTEXT.html.startsWith(endStr, CONTEXT.position)) {
        throw createError('MEX-PO1', {endStr, dataEnd: CONTEXT.position, html: CONTEXT.html});
    }

    // The final step: If there is even a single character left that was not visited thus far
    // the string is not valid ONE microdata. This might be a newline added by an editor
    // automatically for whatever reason, but this would make the SHA-256 hash that the given
    // type and data are expected to have invalid.
    if (CONTEXT.position + endStr.length < CONTEXT.html.length) {
        throw createError('MEX-PO2', {nr: CONTEXT.html.length - CONTEXT.position + endStr.length});
    }

    // TODO TYPE CAST: It is only necessary because of CRDT type hacks messing things up. They
    //  need to be cleaned up...
    return (
        isVersionedObject(obj) ? await storeVersionedObject(obj) : await storeUnversionedObject(obj)
    ) as AnyObjectCreation;
}

/**
 * Convert the microdata representation of a ONE object to Javascript using the rules in
 * object-recipes.js. An exception is thrown if there is a problem during the conversion.
 *
 * Parsing has been optimized to go through the microdata string only *once*. That means we
 * will proceed only forward and never look ahead, for example look for an end-tag and then go
 * back to parse what is in between.
 *
 * Another optimization is that the original HTML string is kept unaltered and no new strings
 * containing parts of the original string are created. Instead, we keep track of the
 * ever-advancing position that our parsing has reached. Each sub-function returns 1) its result
 * and 2) the new position within the original string that has been reached successfully.
 *
 * The only exception are - by necessity - the actual values gained from parsing the string.
 * We have to use one of the high-level Javascript methods (here: String.prototype.slice)
 * without knowing how it is implemented in the respective Javascript runtime (and version).
 *
 * While V8 (and probably other JS engines too) have an internal optimized representation of
 * sub-strings using pointers we don't want to rely on that. For some background see:
 *   http://mrale.ph/blog/2016/11/23/making-less-dart-faster.html
 *
 * If there is any discrepancy between what we expect and what we find the respective function
 * throws an exception immediately. This means the exception-free code path does not need any
 * checks, if the code continues to run we know everything is fine.
 * @static
 * @async
 * @param {string} html - One object in HTML (MicroData) representation
 * @param {(OneObjectTypeNames|OneObjectTypeNames[])} [expectedType] - An optional expected
 * type or an array of expected type names. If it is not matched by the microdata leads to an
 * `Error` when attempting to parse the microdata. Leaving this parameter undefined or
 * setting it to '*' disables the type check.
 * @returns {Promise<AnyObjectCreation>} Returns the result of storing the exploded object. All
 * inner objects were stored separately and replaced by Reference objects.
 * @throws {(Error|Error)}
 */
export async function explode(
    html: string,
    expectedType: OneObjectTypeNames | '*' | OneObjectTypeNames[] = '*'
): Promise<AnyObjectCreation> {
    if (html === undefined) {
        throw createError('MEX-PEXPL1');
    }

    const CONTEXT: ParseContext = {
        html,
        isIdObj: false,
        position: 0
    };

    return await parseObject(
        CONTEXT,
        new Set(Array.isArray(expectedType) ? expectedType : [expectedType])
    );
}
