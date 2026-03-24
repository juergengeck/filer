/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * The module provides the convertMicrodataToObject() function that parses ONE object microdata
 * and returns a Javascript object representing the data. You can find examples in
 * `<PROJECT_HOME>/test/microdata-to-object-test.js`
 *
 * ## Main export: Function ' convert'
 *
 * **The `convert` function is the main export of this module**, all other exports are for
 * low-level performance optimizations that an application probably should not deal with.
 *
 * For example, this minimal Person object with just an email address is converted to the object
 * below:
 *
 * ```javascript
 * import {convertMicrodataToObject} from 'one.core/lib/microdata-to-object.js');
 *
 * console.log(
 *   convertMicrodataToObject(
 *     '<div itemscope itemtype="//refin.io/Person">' +
 *       '<span itemprop="email">foo@bar.com</span>' +
 *       '<span itemprop="name">Foo Bar</span>' +
 *     '</span>'
 *    )
 *  );
 * ```
 * Output:
 * ```
 * {
 *   $type$: "Person",
 *   email: "foo@bar.com",
 *   name: "Foo Bar"
 * }
 * ```
 *
 * When parsing microdata the primary thing the parser looks at actually is not the microdata
 * string - it is the rules in {@link object-recipes.module:ts|object-recipes}. For example,
 * the rules for the `Person` object above could look like in the example below. Rules are
 * described in {@link RecipeRule}.
 *
 * ```javascript
 * Person: [
 *   {
 *     // <span itemprop="email">foo@bar.com</span>
 *     itemprop: 'email',
 *     isId: true
 *   },
 *   {
 *     // <span itemprop="name">Foo Bar</span>
 *     itemprop: 'name'
 *   }
 * ],
 * ```
 *
 * When parsing microdata the parser iterates over the (ordered) sequence of rules. This tells
 * the parser exactly what character(s) it should expect, and if the input string cannot be
 * matched to the expectation the conversion fails with an error. There also is no room for
 * any additional white-space or line-breaks, since every single unexpected character would
 * change the SHA-256 hash of the microdata.
 *
 * ## Other exports
 *
 * In addition to the main conversion function the module also exports the converter's component
 * function, each responsible for part of a microdata object, so that other modules can use them
 * to parse sections of microdata without doing a full conversion of the entire object.
 *
 * It is important to note that those functions were written first of all for this module, and
 * that exposing them via exports was an afterthought - quite deliberately. You notice this in
 * the list of parameters that they require, which are optimized for the beginning-to-end
 * one-step parsing of an entire microdata ONE object without copying strings.
 *
 * Each component function is always given the full microdata string *plus a position
 * (number)*. Each function expects to find what it is told to look for at the exact position
 * that it was given! That means any outside function calling, for example,
 * `parseValueByTheExpectedType` must first find the correct position on its own and only then
 * call `parseValueByTheExpectedType`. This is not a disadvantage for performance, there is no way
 * around searching through the microdata to find that location in any case, and you still
 * bypass the full microdata-to-object converter which would parse every item up to that point.
 *
 * @module
 */

/**
 * This type is used in the ONE microdata parsing modules, first of all in
 * {@link microdata-to-object.module:ts|microdata-to-object}.
 *
 * It is used to store the last value that a particular parser sub-function successfully parsed
 * (if any) as well as the position in the microdata string up to which parsing has advanced.
 *
 * ### Programming style notes:
 *
 * The context object makes the parse functions impure, since the parsing position is stored on
 * the outside. The reason is that we wanted to avoid a complex return type for the parse
 * functions: The parsed value plus the position would both have to be returned, which means an
 * object or array-object (tuple) would have to be created to box the return values. As an
 * optimization, to save on object creations (especially with embedded platform JS runtimes in
 * mind), we create an external object which gets passed into the parse functions as a pointer
 * and whose `position` property is mutated.
 *
 * Most people would make the whole parser a class and use `this` as the context object. We
 * chose to be explicit throughout one.core, which avoids `this` binding issues if an individual
 * parsing function is to be used standalone (since we export a number of those individual
 * partial parser functions that parse only a small section).
 * @global
 * @typedef {object} ParseContext
 * @property {string} html - Read-only property pointing to the microdata string being parsed
 * @property {boolean} [isIdObj] - If `true` expect ID object microdata (with its additional special
 * outer header attribute of `data-id-object="true"`)
 * @property {number} position - **MUTATED** - The position in the microdata string up to which
 * parsing got so far
 */
export interface ParseContext {
    readonly html: string;
    readonly isIdObj: boolean;
    position: number;
}

import type {OneIdObjectInterfaces} from '@OneObjectInterfaces';

import {createError} from './errors.js';
import {ensureValidTypeName, getRecipe, resolveRuleInheritance} from './object-recipes.js';
import {getHashLinkTypeFromRule} from './object-to-microdata.js';
import type {
    MapValue,
    ObjectValue,
    OneIdObjectTypes,
    OneObjectInterfaces,
    OneObjectTypeNames,
    OneObjectTypes,
    OneVersionedObjectTypeNames,
    RecipeRule,
    ReferenceValueTypes,
    ValueType
} from './recipes.js';
import {ID_OBJ_MICRODATA_START, MICRODATA_START} from './util/object.js';
import {substrForceMemCopy} from './util/string.js';
import {isHash} from './util/type-checks.js';

/**
 * TODO This function should not be necessary but use findClosingTag/() instead
 * @static
 * @param {string} html
 * @param {number} position
 * @returns {{start: number, end: number}}
 */
export function extractMicrodataWithTag(
    html: string,
    position: number
): {start: number; end: number} {
    // Place the staring position just after the "<" of the first tag - our current position
    let newPos = position + 1;

    // The tag we start from is already counted
    let openTagsCount = 1;

    while (openTagsCount > 0) {
        newPos = html.indexOf('<', newPos) + 1;

        if (newPos === 0) {
            throw createError('M2IH-FET1', {position, html});
        }

        if (html.charAt(newPos) === '/') {
            openTagsCount -= 1;
        } else {
            openTagsCount += 1;
        }
    }

    return {start: position, end: html.indexOf('>', newPos) + 1};
}

/**
 * Find the end tag for a given opening span tag, skipping over any nested tags. It finds the
 * position just after the last character ">" of the closing tag.
 *
 * ## Assumptions
 *
 * - This function does not check the names of the tags, it only blindly counts "<" (in
 *   combination with a "/" for a closing tag) and ">" characters. This means that any opening
 *   tag should have a corresponding closing tag, which is the case for our microdata (plus, we
 *   only have span tags but that does not matter to this function).
 * - The only tag name assumption is that we are looking for a span tag, and it only matters
 *   because we assume a constant length of the closing tag that we found when returning the final
 *   position.
 * - This function relies on the starting position already being advanced past the initial "<"
 *   character of the opening tag
 * @param {string} html - The HTML string to search
 * @param {number} position - Start searching at this position
 * @returns {number} The position of the character just after the final ">" of the closing tag
 * @throws {Error} Throws an error if no closing tag could be found
 */
export function findClosingTag(html: string, position: number): number {
    // Our policy: Keep the function parameters immutable, even if it does not matter for simple
    // value parameters. One should be able to rely on the function parameters having the same
    // value anywhere in the function.
    let newPos = position;

    // We start after the <span> at position 0 which we already know to be there
    let openTagsCount = 1;

    // Stop when the matching closing span tag has been found that together with the opening one
    // encloses other tags inside it; alternatively, stop if we get to the end of the string
    // without having found such a tag, meaning this is an invalid microdata object.
    while (openTagsCount > 0) {
        // Look for the next HTML tag - opening or closing, starting from the last position.
        // indexOf() returns -1 if it cannot find "<" after the last position.
        // Add 1 to advance to the character after the "<"
        newPos = html.indexOf('<', newPos) + 1;

        if (newPos === 0) {
            throw createError('M2IH-FET1', {position, html});
        }

        // Opening or closing?
        if (html.charAt(newPos) === '/') {
            // This is a closing tag </span>
            openTagsCount -= 1;
        } else {
            // This is an opening tag <span...>. The more open tags we encounter the more
            // closing ones we need to find - plus one to close the opening tag.
            openTagsCount += 1;
        }
    }

    // The NEXT position after the matched end tag string's final ">" character.
    // -1 because we want /a>, /span>, /ol> or /ul>
    return newPos - 1;
}

/**
 *
 * The only concern here is that your microdata must have the same tag that describes the item. E.g.
 * only <span> ... </span> or <li> ... </li> etc
 *
 * Breaks the given array microdata into an array. Parsed by the given params (startStr, endStr).
 * E.g. for the following microdata:
 * ```html
 *  <ol><li>1</li><li>2</li><ol>
 * ```
 * The result will be:
 * ```javascript
 * [1,2]
 * ```
 * @param {string} html
 * @param {string} startingTag
 * @param {string} endingTag
 * @param {number} startingTagPosition
 * @param {number} endingTagPosition
 * @returns {string[]}
 */
export function breakMicrodataIntoArray(
    html: string,
    startingTag: string,
    endingTag: string,
    startingTagPosition: number,
    endingTagPosition: number
): string[] {
    // slice the microdata by the given interval (removing upper tags)
    const slicedMicrodata = html.slice(
        startingTagPosition,
        startingTagPosition + endingTagPosition - startingTagPosition
    );

    const values = [];

    let startPosition = startingTag.length;

    // TODO To be rewritten. We have all the info to know when to end this loop.
    try {
        while (true) {
            const newEndingTagPosition = findClosingTag(slicedMicrodata, startPosition);
            const pieceOfMicrodata = substrForceMemCopy(
                slicedMicrodata,
                startPosition,
                newEndingTagPosition - startPosition
            );
            values.push(pieceOfMicrodata);
            startPosition = newEndingTagPosition + endingTag.length + startingTag.length;
        }
    } catch (err) {
        // Not the greatest stop condition ... but because findClosingTag throws error when the
        // position reaches 0 we can catch that and break the loop
        if (err.code !== 'M2IH-FET1') {
            throw err;
        }
    }

    return values;
}

/**
 * Strings saved inside microdata had to have some special characters replaced. See
 * {@link https://stackoverflow.com/a/7279035/544779}.
 * This is the reverse of what we did when creating microdata strings in function
 * `escapeHtml()` of module {@link object-to-microdata.module:ts|object-to-microdata}
 * @static
 * @param {string} html - A string that needs to be HTML-escaped
 * @returns {string} Returns the HTML-escaped string
 */
export function unescapeFromHtml(html: string): string {
    return String(html).replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

/**
 * @private
 * @param {string} val
 * @returns {string}
 */
function stringToString(val: string): string {
    return unescapeFromHtml(val);
}

/**
 * @private
 * @param {string} val
 * @returns {boolean}
 */
function stringToBoolean(val: string): boolean {
    return unescapeFromHtml(val) === 'true';
}

/**
 * We don't use parseInt or parseFloat because we got exact representations - all
 * numbers were originally Javascript numbers, integer or float, and were written
 * using their own toString() method. So reading and converting them back to a
 * number should work fine with Number(...)
 * @private
 * @param {string} val
 * @returns {number}
 */
function stringToNumber(val: string): number {
    return Number(unescapeFromHtml(val));
}

/**
 * I used https://stackoverflow.com/a/39154413/544779 for inspiration.
 * RegExp as string (regexp.toString()) example: "/ab\/\n/g"
 * @private
 * @param {string} val
 * @returns {RegExp}
 */
function stringToRegexp(val: string): RegExp {
    const flagsPosition = unescapeFromHtml(val).lastIndexOf('/');
    return new RegExp(
        // Exclude the leading and trailing "/" slashes
        unescapeFromHtml(val).substring(1, flagsPosition),
        // Start after the trailing "/" slash
        unescapeFromHtml(val).substring(flagsPosition + 1)
    );
}

/**
 * No try/catch - we *want* this to throw if the JSON is invalid! It makes the
 * entire object invalid, there should not be a ONE object with syntactically
 * wrong data in the first place.
 * @private
 * @param {string} val
 * @returns {*} The returned value is the value encoded in the JSON string
 */
function stringToObject(val: string): unknown {
    return JSON.parse(unescapeFromHtml(val));
}

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
    const endStr = '</span>';
    const startStrLen = startStr.length;

    if (!CONTEXT.html.startsWith(startStr, CONTEXT.position)) {
        return undefined;
    }

    const valueStart = CONTEXT.position + startStrLen;
    const valueEnd = CONTEXT.html.indexOf('<', valueStart);

    const valueStr = substrForceMemCopy(CONTEXT.html, valueStart, valueEnd - valueStart);
    CONTEXT.position += startStrLen + valueStr.length + endStr.length;

    return valueStr;
}

/**
 * Extracts a SHA256 from the given microdata
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule.itemprop} rule
 * @param {ReferenceValueTypes.type} referenceType
 * @param {boolean} isNested
 * @returns {unknown}
 */
function extractReferenceTypeFromMicrodata(
    CONTEXT: ParseContext,
    rule: RecipeRule,
    referenceType: ReferenceValueTypes['type'],
    isNested: boolean = false
): unknown {
    const startStr = isNested
        ? `<a data-type="${getHashLinkTypeFromRule(referenceType)}">`
        : `<a itemprop="${rule.itemprop}" data-type="${getHashLinkTypeFromRule(referenceType)}">`;
    const endStr = '</a>';
    const startStrLen = startStr.length; // + {hash}"> = 64 + 2

    const valueStart = CONTEXT.position + startStrLen;
    const valueEnd = CONTEXT.html.indexOf('<', valueStart);

    const valueStr = substrForceMemCopy(CONTEXT.html, valueStart, valueEnd - valueStart);

    if (!CONTEXT.html.startsWith(startStr, CONTEXT.position)) {
        return undefined;
    }

    if (!isHash(valueStr)) {
        throw createError('M2O-PV1', {itemprop: rule.itemprop, valueStr});
    }
    CONTEXT.position += startStrLen + valueStr.length + endStr.length;
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
function extractOrderedListTypeFromMicrodata(
    CONTEXT: ParseContext,
    rule: RecipeRule,
    itemType: ValueType,
    isNested: boolean = false
): unknown[] | undefined {
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

    return extractedValues.map(li => {
        return parseMicrodataByTheExpectedType(
            itemType,
            rule,
            // isolated CONTEXT
            {
                ...CONTEXT,
                position: 0,
                html: li
            },
            true
        );
    });
}

/**
 * Extracts map object from the given microdata.
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule.itemprop} rule
 * @param {MapValue} valueType
 * @param {boolean} isNested
 * @returns {Map<unknown, unknown>}
 */
function extractMapTypeFromMicrodata(
    CONTEXT: ParseContext,
    rule: RecipeRule,
    valueType: MapValue,
    isNested: boolean = false
): Map<unknown, unknown> | undefined {
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
        const key = parseMicrodataByTheExpectedType(
            valueType.key,
            rule,
            // isolated CONTEXT
            {
                ...CONTEXT,
                position: 0,
                html: extractedValues[i]
            },
            true
        );

        const value = parseMicrodataByTheExpectedType(
            valueType.value,
            rule,
            // isolated CONTEXT
            {
                ...CONTEXT,
                position: 0,
                html: extractedValues[i + 1]
            },
            true
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
function extractUnorderedListTypeFromMicrodata(
    CONTEXT: ParseContext,
    rule: RecipeRule,
    itemType: ValueType,
    isNested: boolean = false
): unknown[] | undefined {
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

    return extractedValues.map(li => {
        return parseMicrodataByTheExpectedType(
            itemType,
            rule,
            // isolated CONTEXT
            {
                ...CONTEXT,
                position: 0,
                html: li
            },
            true
        );
    });
}

/**
 * Extracts an object from the given microdata.
 * @param {ParseContext} CONTEXT
 * @param {RecipeRule} rule
 * @param {ObjectValue} valueType
 * @returns {unknown}
 */
function extractObjectTypeFromMicrodata(
    CONTEXT: ParseContext,
    rule: RecipeRule,
    valueType: ObjectValue
): unknown {
    let startStr;
    let endStr;

    if (CONTEXT.html.startsWith(`<div itemprop="${rule.itemprop}">`, CONTEXT.position)) {
        // If it is a standalone object, it has an attribute "itemprop"
        startStr = `<div itemprop="${rule.itemprop}">`;
        endStr = '</div>';
    } else {
        startStr = '<div>';
        endStr = '</div>';
    }

    const mandatoryProps: string[] = [];
    valueType.rules.forEach(vRule => {
        const actualRule = resolveRuleInheritance(vRule);

        if (actualRule.optional === undefined || !actualRule.optional) {
            mandatoryProps.push(actualRule.itemprop);
        }
    });

    const startStrLen = startStr.length;

    if (CONTEXT.html.startsWith(startStr + endStr, CONTEXT.position)) {
        if (mandatoryProps.length > 0) {
            throw createError('M2O-EOTFM1', {
                itemprop: mandatoryProps.join(', '),
                html: CONTEXT.html
            });
        }

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
        const newPositions = extractMicrodataWithTag(unWrappedMicrodata, newStartPos);
        extractedValues.push(unWrappedMicrodata.slice(newPositions.start, newPositions.end));
        newStartPos = newPositions.end;
    }

    const obj: {[key: string]: unknown} = {};

    extractedValues.forEach(microdata => {
        for (const objectRule of valueType.rules) {
            const actualRule = resolveRuleInheritance(objectRule);

            if (
                microdata.startsWith(
                    `itemprop="${actualRule.itemprop}"`,
                    microdata.indexOf('itemprop')
                )
            ) {
                obj[actualRule.itemprop] = parseMicrodataByTheExpectedType(
                    actualRule.itemtype,
                    actualRule,
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
    });

    const missingMandatoryProps = mandatoryProps.filter(
        itemprop => !Object.prototype.hasOwnProperty.call(obj, itemprop)
    );

    if (missingMandatoryProps.length > 0) {
        throw createError('M2O-EOTFM1', {
            itemprop: missingMandatoryProps.join(', '),
            html: CONTEXT.html
        });
    }

    CONTEXT.position = endTagPosition + endStr.length;

    return obj;
}

/**
 * The conversion functions allow us to have non-string types when working with data that
 * is always saved as (microdata) string. Using type meta information stored in the rule-sets in
 * object-recipes.js conversions from microdata (string) to the actual (Javascript) type are
 * performed as part of the microdata-to-object conversion.
 * The function is exported to be used by other modules. For example, the map-helper module uses
 * it to convert dynamic types. Those are not set in the rule-sets but stored with the actual
 * individual object (see map object definitions in the recipes).
 *
 * Programmer note: The advantage of this vs. one big function with a switch/case statement is
 * that the latter cannot be optimized by the JS runtime (compiled) because the types it returns
 * keep changing all the time. The type signatures of these short functions on the other hand
 * are stable.
 *
 * The conversion functions each take one string argument of unescaped microdata (i.e. "<", ">"
 * and "&" characters written as HTML entities), unescape the microdata string to a regular
 * string with the escaped characters replaced by the actual characters, convert the string to
 * the respective type, and return the result.
 * @static
 * @type {object}
 * @property {function(string):string} string - (string) => string
 * @property {function(string):boolean} boolean - (string) => boolean
 * @property {function(string):number} number - (string) => number
 * @property {function(string):RegExp} regexp - (string) => RegExp
 * @property {function(string):object} object - (string) => Object
 * @property {function(string):Map} Map - (string) => Map
 * @property {function(string):Set} Set - (string) => Set
 */
export const CONVERSION_FUNCTIONS: {[key: string]: (value: string) => any} = {
    string: stringToString,
    boolean: stringToBoolean,
    number: stringToNumber,
    integer: stringToNumber,
    stringifiable: stringToObject,
    regexp: stringToRegexp
} as const;

/**
 *
 * @static
 * @type {object}
 * @property {function(CONTEXT, rule, isNested):unknown} primitive - (CONTEXT, rule, isNested) =>
 *     unknown
 * @property {function(CONTEXT, rule, isNested):unknown} reference - (CONTEXT, rule, isNested) =>
 *     unknown
 * @property {function(CONTEXT, rule, isNested):unknown[]} unorderedCollection - (CONTEXT, rule,
 *     isNested) => unknown[]
 * @property {function(CONTEXT, rule, isNested):unknown[]} orderedArray - (CONTEXT, rule, isNested)
 *     => unknown[]
 * @property {function(CONTEXT, rule, isNested):unknown} map - (CONTEXT, rule, isNested) => unknown
 * @property {function(CONTEXT, rule, isNested):unknown} obj - (CONTEXT, rule, isNested) => unknown
 */
const EXTRACT_FUNCTIONS = {
    primitive: extractPrimitiveTypeFromMicrodata,
    reference: extractReferenceTypeFromMicrodata,
    unorderedCollection: extractUnorderedListTypeFromMicrodata,
    orderedCollection: extractOrderedListTypeFromMicrodata,
    map: extractMapTypeFromMicrodata,
    obj: extractObjectTypeFromMicrodata
} as const;

/**
 *
 * @param {ValueType} valueType
 * @param {RecipeRule} rule
 * @param {ParseContext} CONTEXT
 * @param {boolean} isNested
 * @returns {unknown}
 */
function parseMicrodataByTheExpectedType(
    valueType: ValueType = {type: 'string'},
    rule: RecipeRule,
    CONTEXT: ParseContext,
    isNested: boolean = false
): unknown {
    switch (valueType.type) {
        case 'string': {
            const valueStr = EXTRACT_FUNCTIONS.primitive(CONTEXT, rule, isNested);

            // This _must_ be a string value or somebody managed to sneak an impossible recipe
            // by our Recipe type check. In type-check's ensureRecipeRule() we ensure that a RegExp
            // can only be set for string properties, but we still check if it is a string because the
            // static type checker does not understand that larger context. Plus, extra safety.
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
        case 'referenceToObj':
        case 'referenceToId':
        case 'referenceToClob':
        case 'referenceToBlob': {
            return EXTRACT_FUNCTIONS.reference(CONTEXT, rule, valueType.type, isNested);
        }
        case 'array': {
            return EXTRACT_FUNCTIONS.orderedCollection(CONTEXT, rule, valueType.item, isNested);
        }
        case 'map':
            return EXTRACT_FUNCTIONS.map(CONTEXT, rule, valueType, isNested);
        case 'bag': {
            return EXTRACT_FUNCTIONS.unorderedCollection(CONTEXT, rule, valueType.item, isNested);
        }
        case 'set': {
            const v = EXTRACT_FUNCTIONS.unorderedCollection(
                CONTEXT,
                rule,
                valueType.item,
                isNested
            );
            return v === undefined ? undefined : new Set(v);
        }
        case 'object':
            return EXTRACT_FUNCTIONS.obj(CONTEXT, rule, valueType);
    }
}

/**
 * Parses only the inner data part of a ONE microdata object, i.e. the outer frame opening span
 * tag has already been parsed and the HTML starting at the given position in  only contains
 * span tags with actual data. This function continues until all rules are exhausted and the last
 * rule ended up finding no matching string (i.e. no matching data value in a span tag with the
 * expected itemprop name).
 * @static
 * @param {OneObjectTypeNames} type - The type was already found by the caller. This function
 * expects it so that it can insert it into the returned object before any data properties so
 * that in the iteration order of Javascript objects implicitly set (for non-numerical
 * properties) through insertion order it gets the first spot. This is for human readers of raw
 * data output, the code does not care.
 * @param {RecipeRule[]} rules - An array of rules corresponding to all rules for a given ONE
 * object type from ONE object recipes
 * @param {ParseContext} CONTEXT
 * @returns {OneObjectTypes}
 * @throws {Error}
 */
export function parseData<K extends OneObjectTypeNames>(
    type: K,
    rules: readonly RecipeRule[],
    CONTEXT: ParseContext
): OneObjectInterfaces[K] {
    // The ONE object to add the parsed data to, pre-filled with the "type" property.
    // Type cast because this still needs to be filled with data properties
    const obj: Record<string, any> = {$type$: type};

    for (const rule of rules) {
        // No rules.filter() because this module should use low-level style to avoid any
        // unnecessary overhead caused by runtimes that don't optimize perfectly (filter() calls
        // another function and returns a new array too).
        if (CONTEXT.isIdObj && !rule.isId) {
            continue;
        }

        const actualRule = resolveRuleInheritance(rule);

        const value = parseMicrodataByTheExpectedType(actualRule.itemtype, actualRule, CONTEXT);

        if (value === undefined && actualRule.optional !== true) {
            throw createError('M2O-PD1', {itemprop: actualRule.itemprop, html: CONTEXT.html});
        }

        if (value !== undefined) {
            obj[actualRule.itemprop] = value;
        }
    }

    return obj as OneObjectInterfaces[K];
}

/**
 * This function only parses the opening enclosing "`itemscope`" span tag, extracts the type
 * string and optionally compares it to a given expected type, and advances the position counter
 * to the next character after the tag it was responsible for parsing.
 *
 * Example
 * ```html
 * <div itemscope itemtype="//refin.io/Person">
 * ```
 * leads to a return value of
 * ```javascript
 * {value: 'Person', position: 51}
 * ```
 *
 * **Note** that while `convert` takes a single string this function expects a `Set` object
 * to make it more flexible to accommodate `parseObject`, which also uses a `Set` that it in
 * turn receives from the recipe used to parse a *sub-*object.
 * @static
 * @param {Set<OneObjectTypeNames|"*">} [expectedType] - Expect certain type strings, or '*' if we
 * should accept any ONE object type that we have a recipe for. For included sub-objects this is
 * set to the Set object of the recipe rule, for top-level objects this is set by the caller.
 * @param {ParseContext} CONTEXT
 * @returns {OneObjectTypeNames}
 * @throws {Error} Throws errors if the HTML could not be parsed, and also if the parsed type
 * string is not a known ONE object type name
 */
export function parseHeader<K extends OneObjectTypeNames>(
    expectedType: undefined | Set<K | '*'>,
    CONTEXT: ParseContext
): K {
    if (!CONTEXT.html.startsWith(CONTEXT.isIdObj ? ID_OBJ_MICRODATA_START : MICRODATA_START, 0)) {
        // This is the outermost span tag, no excuses...
        throw createError('M2O-PH1', {html: CONTEXT.html, isIdObj: CONTEXT.isIdObj});
    }

    CONTEXT.position += CONTEXT.isIdObj ? ID_OBJ_MICRODATA_START.length : MICRODATA_START.length;

    // Find the type string: between the end of startStr and "> completing the tag
    // If the "type" refers to a version of a versioned Recipe there will be a "#VersionTag"
    // after the actual type name
    const type = ensureValidTypeName(
        substrForceMemCopy(
            CONTEXT.html,
            CONTEXT.position,
            CONTEXT.html.indexOf('">', CONTEXT.position) - CONTEXT.position
        )
    );

    // Type check:
    // 1) For included sub-objects always using the Set from rule.referenceToObj
    // 2) For top-level objects only when the caller of the module-export convert function
    //    included a type string
    if (expectedType && !(expectedType.has(type as any) || expectedType.has('*'))) {
        throw createError('M2O-PHM1', {expectedType, type, html: CONTEXT.html});
    }

    CONTEXT.position += type.length + 2; // ">

    return type as K;
}

/**
 * Parses a complete html object including the outer frame that contains the type. There
 * are two parts: First the opening outer span tag is parsed for the type information, then the
 * html inside the outer frame is parsed for the data. The type string is used to find the
 * rule-set to use for parsing - the order of rules determines the order data properties are
 * expected. When the function returns there should be exactly the closing span tag of the outer
 * frame left unparsed (of the current object - if this is an inner/included object).
 *
 * - parseObject() it the top-level function to parse microdata into objects, determining the type
 *   and creating the object that is going to be returned.
 * - parseData() is the next-level function, parsing all the actual data of an object. It yields
 *   the object on the "data" property of the returned object.
 * - parseMicrodataByTheExpectedType() is the third-level function, parsing individual values,
 *   which can also be arrays. It tries to apply a rule from ObjectRecipes.getRecipe(type).rule
 *   to the HTML until there either is no more HTML left or the remaining HTML does not fit the
 *   rule it is working on.
 *
 * **Note** that while `convert` takes a single string this function expects a `Set` object
 * because it needs to be more flexible: It uses the recipe rule's `type` property which is a
 * `Set` object.
 * @static
 * @param {Set<OneObjectTypeNames|"*">} expectedType - Expect certain type strings, or '*' if
 * we should accept any ONE object type that we have a recipe for. For included sub-objects this
 * is set to the Set object of the recipe rule, for top-level objects this is set by the caller.
 * @param {ParseContext} CONTEXT
 * @returns {undefined|OneObjectTypes}
 * @throws {Error}
 */
export function parseObject(
    expectedType: Set<OneObjectTypeNames | '*'>,
    CONTEXT: ParseContext
): OneObjectTypes {
    const type = parseHeader(expectedType, CONTEXT);

    // We get the data-object of the ONE object and the position in the HTML microdata string
    // immediately after the last character of the last data item.
    const obj = parseData(
        // "type" is sent so that it can be inserted right away to be at #1 position in the
        // "order" of properties (when iterating) defined by insertion order.
        type,
        // New position: Immediately after the end of the outer span tag with the type, which
        // surrounds the actual data span tags.
        getRecipe(type).rule,
        CONTEXT
    );

    // When the data parsing is done we should find the end-tag next and nothing else.
    const endStr = '</div>';

    if (!CONTEXT.html.startsWith(endStr, CONTEXT.position)) {
        throw createError('M2O-POM1', {endStr, position: CONTEXT.position, html: CONTEXT.html});
    }

    // New position: Immediately after the closing </span> of the (sub?-)object we just
    // finished parsing.
    CONTEXT.position += endStr.length;

    return obj;
}

export function convertMicrodataToObject(html: string): OneObjectTypes;
export function convertMicrodataToObject<T extends OneObjectTypeNames>(
    html: string,
    expectedType: T
): OneObjectInterfaces[T];
export function convertMicrodataToObject<T extends OneObjectTypeNames>(
    html: string,
    expectedType: T[]
): OneObjectInterfaces[T];
export function convertMicrodataToObject<T extends OneObjectTypeNames>(
    html: string,
    expectedType: T | T[] | '*'
): OneObjectTypes;

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
 *
 * @static
 * @param {string} html - One object in HTML (MicroData) representation
 * @param {(OneObjectTypeNames|OneObjectTypeNames[])} [expectedType] - An optional expected
 * type, or an array of expected type names, which when not matched by the microdata leads to a
 * `Error` when attempting to parse the microdata. Leaving this parameter undefined or setting
 * it to '*' disables the type check.
 * @returns {OneObjectTypes} Returns the Javascript object version of the parsed microdata
 * @throws {(Error|Error)}
 */
export function convertMicrodataToObject(html: string, expectedType: any = '*'): OneObjectTypes {
    if (html === undefined) {
        throw createError('M2O-PCONV1');
    }

    const CONTEXT: ParseContext = {
        html,
        isIdObj: false,
        position: 0
    };

    const obj = parseObject(
        new Set(
            Array.isArray(expectedType) ? expectedType : ([expectedType] as OneObjectTypeNames[])
        ),
        CONTEXT
    );

    // The final step: If there is even a single character left that was not visited thus far
    // the string is not valid ONE microdata. This might be a newline added by an editor
    // automatically for whatever reason, but this would make the SHA-256 hash that the given
    // type and data are expected to have invalid.
    if (CONTEXT.position < html.length) {
        throw createError('M2O-PCONV2', {nr: html.length - CONTEXT.position, html: CONTEXT.html});
    }

    return obj;
}

export function convertIdMicrodataToObject(html: string): OneIdObjectTypes;
export function convertIdMicrodataToObject<T extends OneVersionedObjectTypeNames>(
    html: string
): OneIdObjectInterfaces[T];
export function convertIdMicrodataToObject<T extends OneVersionedObjectTypeNames>(
    html: string,
    expectedType: T
): OneObjectInterfaces[T];
export function convertIdMicrodataToObject<T extends OneVersionedObjectTypeNames>(
    html: string,
    expectedType: T[]
): OneIdObjectInterfaces[T];
export function convertIdMicrodataToObject<T extends OneObjectTypeNames>(
    html: string,
    expectedType: T | T[] | '*'
): OneIdObjectTypes;

/**
 * See {@link convertMicrodataToObject}. This function is the same *except it expects ID object
 * microdata*.with an extra ID object attribute `data-id-object="true"` in the outer `<span>`.
 * This is an extra function because ID objects are not valid ONE objects unless all non-ID
 * properties are optional. They also serve a different purpose, instead of being used to store
 * data they are used to point to ONE objects that are versions under the ID object.
 * We keep ID objects only to be able to be able to tell, given an ID hash, which (ID) properties
 * created it.
 *
 * Also, while microdata of ID objects is different from microdata of a ONE object that has the
 * exact same type and properties (possible if all non-ID properties are optional), there is no
 * Javascript object format for ID objects. That is because ID objects are created on the fly
 * from regular ONE objects and are ephemeral, only used to create an ID hash.
 *
 * That means the objects returned by this function *look* like ONE objects, but rarely are
 * (only when all non-ID properties of the `$type$` are optional).
 * @static
 * @param {string} html - One object in HTML (MicroData) representation
 * @param {(OneObjectTypeNames|OneObjectTypeNames[])} [expectedType] - An optional expected
 * type or an array of expected type names which when not matched by the microdata leads to a
 * `Error` when attempting to parse the microdata. Leaving this parameter undefined or setting
 * it to '*' disables the type check.
 * @returns {OneObjectTypes} Returns the Javascript object version of the parsed microdata
 * @throws {(Error|Error)}
 */
export function convertIdMicrodataToObject(
    html: string,
    expectedType: any = '*'
): OneIdObjectTypes {
    if (html === undefined) {
        throw createError('M2O-PCONV1');
    }

    const CONTEXT: ParseContext = {
        html,
        isIdObj: true,
        position: 0
    };

    const obj = parseObject(
        new Set(
            Array.isArray(expectedType) ? expectedType : ([expectedType] as OneObjectTypeNames[])
        ),
        CONTEXT
    ) as OneIdObjectTypes;

    // The final step: If there is even a single character left that was not visited thus far
    // the string is not valid ONE microdata. This might be a newline added by an editor
    // automatically for whatever reason, but this would make the SHA-256 hash that the given
    // type and data are expected to have invalid.
    if (CONTEXT.position < html.length) {
        throw createError('M2O-PCONV2', {nr: html.length - CONTEXT.position, html: CONTEXT.html});
    }

    return obj;
}
