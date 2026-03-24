/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module provides the same functionality as module microdata-to-object, but the result is
 * not a Javascript object but a JSON encoded string representation. The purpose of this module
 * is to serve as a shortcut, instead of converting a ONE object in microdata form to a
 * Javascript object and then JSON-stringify it this provides a more efficient path. Since no
 * objects have to be created, both input and output are strings, this probably also conserves
 * memory.
 * @module
 */

/* ***********************************************************************************************
 *
 * THIS MODULE IS ALMOST EXACTLY THE SAME AS microdata-to-object.js
 *
 * Main difference: The final product is a string and not an object
 *
 *
 * ********************************************************************************************* */

import {createError} from './errors.js';
import type {ParseContext} from './microdata-to-object.js';
import {parseData, parseHeader} from './microdata-to-object.js';
import {getRecipe} from './object-recipes.js';
import type {OneObjectTypeNames} from './recipes.js';
import {isIdObjMicrodata} from './util/object.js';
import {stringify} from './util/sorted-stringify.js';
import {isString} from './util/type-checks-basic.js';

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
 *
 * @private
 * @param {Set<OneObjectTypeNames|"*">} expectedType - Expect certain type strings, or '*' if
 * we should accept any ONE object type that we have a recipe for. For included sub-objects this
 * is set to the Set object of the recipe rule, for top-level objects this is set by the caller.
 * @param {ParseContext} CONTEXT
 * @returns {(undefined|string)}
 * @throws {Error}
 */
function parseObject(
    expectedType: Set<OneObjectTypeNames | '*'>,
    CONTEXT: ParseContext
): undefined | string {
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

    // New position: Immediately after the closing </span> of the (sub?-)object we just
    // finished parsing.
    CONTEXT.position = CONTEXT.html.lastIndexOf('</div>') + '</div>'.length;

    return stringify(obj);
}

/**
 * Convert the microdata representation of a ONE object directly to a JSON string. This is the
 * same parser as in microdata-to-object.js,
 *
 * @example
 *
 * const json = convertMicrodataToJSON(
 *   '<div itemscope itemtype="//refin.io/Person">' +
 *     '<span itemprop="email">winfried@mail.com</span>' +
 *   '</span>'
 * );
 * console.log(json);
 * // {"type":"Person","data":{"email":"winfried@mail.com"}}
 * @see
 * {@link microdata-to-object.module:ts.convertMicrodataToObject|microdata-to-object.convertMicrodataToObject}
 * @static
 * @param {string} html - One object in HTML (MicroData) representation
 * @param {(OneObjectTypeNames|OneObjectTypeNames[])} [expectedType] - An optional expected
 * type or an array of expected type names which when not matched by the microdata leads to a
 * `Error` when attempting to parse the microdata. Leaving this parameter undefined or setting
 * it to '*' disables the type check.
 * @returns {string} Returns the JSON string version of the parsed microdata
 * @throws {(Error|Error)}
 */
export function convertMicrodataToJSON(html: string, expectedType: any = '*'): string {
    if (!isString(html)) {
        throw createError('M2J-CONV1');
    }

    const CONTEXT: ParseContext = {
        html,
        isIdObj: isIdObjMicrodata(html),
        position: 0
    };

    const value = parseObject(
        new Set(
            Array.isArray(expectedType) ? expectedType : ([expectedType] as OneObjectTypeNames[])
        ),
        CONTEXT
    );

    // The final step: If there is even a single character left that was not visited thus far
    // the string is not valid ONE microdata. This might be a newline added by an editor
    // automatically for whatever reason, but this would make the SHA-256 hash that the given
    // type and data are expected to have invalid.
    if (value === undefined) {
        throw createError('M2J-CONV2', {nr: html.length - CONTEXT.position});
    }

    return value;
}
