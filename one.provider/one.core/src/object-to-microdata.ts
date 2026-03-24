/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2021
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module contains the functions to convert ONE objects in their Javascript representation
 * to a UTF-8 microdata string, the format ONE objects are stored in and - very important! - from
 * which the SHA-256 representing the ONE object is calculated.
 *
 * ## ABOUT ONE MICRODATA
 *
 * "Recipes" are a collection of rules used to construct microdata strings. ONE microdata
 * *must* be much more finical about syntax than HTML: After all, a crypto-hash of the
 * microdata string is used to identify the object, and identical data must produce an
 * identical crypto-hash!
 *
 * Therefore, in order to ensure that microdata created as representation for data is created
 * exact down to the last character we use *recipes* to transform data into microdata.
 *
 * To remove any ambiguity there is no unnecessary whitespace: ONE microdata HTML is on one
 * line, with one space exactly to separate components within one tag (name, attributes) and no
 * spaces or newlines between tags unless they belong to the encapsulated data (strings).
 *
 * The same rules used to create the microdata string are used to parse them, the module
 * object-recipes.js has the recipes.
 *
 * To get an identical crypto-hash we must also impose an exact order on the items in the
 * microdata string. We do this by using an array instead of a hash to store the rules for the
 * individual items for each ONE object type. The ordering of the array is used during
 * creation and also during parsing of ONE Microdata.
 *
 * A ONE microdata object contains any of these items:
 *   a) simple values (strings - everything that is not a string must be "stringified")
 *   b) simple links: hashes pointing to unspecified files (BLOBs/CLOBs) identified by their
 *      crypto-hash
 *   c) ONE object links: hashes pointing to files containing another ONE microdata object
 *   d) ("imploded form") instead of a link to a ONE object it can contain that object directly.
 *   e) same as d) but it is a direct include, not an imploded reference object
 *
 * The rules to create ONE objects are kept as simple as possible. Data checks are mostly left
 * out of the specification apart from basic "type" tests. The converter will write whatever it
 * gets, as long as there is a rule for it, and it will write it n times or just once depending
 * on if it gets an array or an individual value. Similarly, the parser will read what is there.
 * If an Email ONE object is missing the From address or if it contains two subject fields
 * instead of one is something a higher level module should be concerned about.
 *
 * Any data not found in a rule is ignored (we iterate over the rule-set and then grab the
 * required data from the object).
 *
 * Any rule for which there is no data is ignored, unless it is an ID rule - ID fields are
 * mandatory.
 *
 * RULE MEANINGS: See object-recipes.js, in particular the definition of the JSDoc type
 * {@link RecipeRule}.
 *
 * @module
 */

/**
 * Hash link type identifier strings returned by {@link getHashLinkTypeFromRule}
 * @typedef {'obj'|'id'|'clob'|'blob'} HashLinkTypeStrings
 */
export type HashLinkTypeNames = 'obj' | 'id' | 'clob' | 'blob';

/**
 * Enum for the various reference hash types that can occur in a ONE object. They directly
 * correspond to the reference types in module object-find-link's {@link LinkedObjectsHashList}
 * @global
 * @type {{BLOB: 'blob', CLOB: 'clob', OBJ: 'obj', ID: 'id'}}
 */
export const HashLinkType = {
    OBJ: 'obj',
    BLOB: 'blob',
    CLOB: 'clob',
    ID: 'id'
} as const;

import {createError} from './errors.js';
import {getRecipe, resolveRuleInheritance} from './object-recipes.js';
import type {
    ArrayValue,
    BagValue,
    BooleanValue,
    IntegerValue,
    MapValue,
    NumberValue,
    ObjectValue,
    OneIdObjectTypes,
    OneObjectTypes,
    RecipeRule,
    SetValue,
    StringValue,
    ValueType
} from './recipes.js';
import {ID_OBJECT_ATTR} from './util/object.js';
import {stringify} from './util/sorted-stringify.js';
import {getObjTypeName, isObject} from './util/type-checks-basic.js';
import {isHash} from './util/type-checks.js';

/**
 * If we save random user/3rd party supplied strings within an HTML document we must escape
 * characters that would cause problems with HTML parsing. The reverse is done in the module
 * doing the opposite conversion from microdata to (Javascript) object.
 *
 * The strings go between HTML tags, for attributes inside HTML tags we would also have to
 * change single and double quote characters because both could be used to enclose the attribute
 * string. Something to keep in mind should ONE microdata ever use attributes.
 *
 * See {@link https://stackoverflow.com/a/7279035/544779}
 * @static
 * @param {string} value - The raw string of a ONE object property value potentially containing
 * characters that would break the HTML parsing of the microdata
 * @returns {string} Returns the string with "<", ">" and "&" characters replaced by their
 * respective HTML entities
 */
export function escapeForHtml(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;') // This must go first! We create new "&" characters next...
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Converts the given array into microdata. Array is ordered by the app.
 * E.g. the following array ['string1', 'string2'] will be transformed into this:
 * ```html
 * <ol itemprop="some-item-prop">
 *     <li> string1 </li>
 *     <li> string2 </li>
 * </ol>
 * ```
 * @param {unknown} newVal
 * @param {string} itemProp
 * @param {ArrayValue} valueType
 * @returns {string}
 */
function convertArrayValueType(newVal: unknown, itemProp: string, valueType: ArrayValue): string {
    if (!Array.isArray(newVal)) {
        throw createError('O2M-RTYC1', {
            itemprop: itemProp,
            type: valueType.type,
            val: newVal
        });
    }

    if (newVal.length === 0) {
        return '';
    }

    const htmlsListItems = newVal.map(
        val => `<li>${convertValueByType(val, itemProp, valueType.item, true)}</li>`
    );

    return htmlsListItems.join('');
}

/**
 * Converts the given bag into microdata. Array is ordered by ONE.
 * E.g. the following array ['string1', 'string2'] will be transformed into this:
 * ```html
 * <ul itemprop="some-item-prop">
 *     <li> string1 </li>
 *     <li> string2 </li>
 * </ul>
 * ```
 * @param {unknown} newVal
 * @param {string} itemProp
 * @param {BagValue} valueType
 * @returns {string}
 */
function convertBagType(newVal: unknown, itemProp: string, valueType: BagValue): string {
    if (!Array.isArray(newVal)) {
        throw createError('O2M-RTYC1', {
            itemprop: itemProp,
            type: valueType.type,
            val: newVal
        });
    }

    if (newVal.length === 0) {
        return '';
    }

    const htmlsListItems = newVal.map(
        val => `<li>${convertValueByType(val, itemProp, valueType.item, true)}</li>`
    );

    return htmlsListItems.sort().join('');
}

/**
 * Converts the given map into microdata.
 * E.g. the following map new Map([['key1','string1'],['key2','string2']]) will be transformed into
 * this:
 * ```html
 * <dl itemprop="some-item-prop">
 *     <dt> key1 </dt>
 *     <dd> string1 </dd>
 *     <dt> key2 </dt>
 *     <dd> string2 </dd>
 * </dl>
 * ```
 * @param {unknown} newVal
 * @param {string} itemProp
 * @param {MapValue} valueType
 * @returns {string}
 */
function convertMapType(newVal: unknown, itemProp: string, valueType: MapValue): string {
    if (getObjTypeName(newVal) !== 'Map') {
        throw createError('O2M-RTYC1', {
            itemprop: itemProp,
            type: valueType.type,
            val: newVal
        });
    }

    const castedNewVal = newVal as Map<unknown, unknown>;

    if (castedNewVal.size === 0) {
        return '';
    }

    const mapKeys = Array.from(castedNewVal.keys());
    const mapHtmlListItems = mapKeys.map(key => {
        const mapValues = castedNewVal.get(key);
        const htmlForKey = convertValueByType(key, itemProp, valueType.key, true);
        const htmlForValue = convertValueByType(mapValues, itemProp, valueType.value, true);
        return `<dt>${htmlForKey}</dt><dd>${htmlForValue}</dd>`;
    });

    return mapHtmlListItems.join('');
}

/**
 * Converts the given bag into microdata. Array is ordered by ONE.
 * E.g. the following set ['string1', 'string2'] will be transformed into this:
 * ```html
 * <ul itemprop="some-item-prop">
 *     <li> string1 </li>
 *     <li> string2 </li>
 * </ul>
 * ```
 * @param {unknown} newVal
 * @param {string} itemProp
 * @param {SetValue} valueType
 * @returns {string}
 */
function convertSetType(newVal: unknown, itemProp: string, valueType: SetValue): string {
    if (!(newVal instanceof Set)) {
        throw createError('O2M-RTYC1', {
            itemprop: itemProp,
            type: valueType.type,
            val: newVal
        });
    }

    const arr = Array.from(newVal);

    const htmlsListItems = arr.map(
        val => `<li>${convertValueByType(val, itemProp, valueType.item, true)}</li>`
    );

    return htmlsListItems.sort().join('');
}

/**
 * Converts the given object into microdata.
 * E.g. the following object {foo: 2} will be transformed into this:
 * ```html
 * <div itemprop="some-item-prop">
 *     <span itemprop="foo">2</span>
 * </div>
 * ```
 * @param {unknown} newVal
 * @param {string} itemProp
 * @param {ObjectValue} valueType
 * @param {boolean} [isNestedCall=false]
 * @returns {string}
 */
function convertNestedObjectType(
    newVal: unknown,
    itemProp: string,
    valueType: ObjectValue,
    isNestedCall: boolean = false
): string {
    if (!isObject(newVal)) {
        throw createError('O2M-RTYC1', {
            itemprop: itemProp,
            type: valueType.type,
            val: newVal
        });
    }

    const objectKeys = Object.keys(newVal);

    const objectHtml = valueType.rules.map(rule => {
        const foundTypeForKey = objectKeys.find(key => rule.itemprop === key);
        const val = (newVal as {[key: string]: any})[foundTypeForKey as string];

        if (!foundTypeForKey && !rule.optional) {
            throw createError('O2M-RTYC2', {itemprop: rule.itemprop, rule});
        }

        if (val === undefined && rule.optional) {
            return '';
        }

        return `${convertValueByType(val, rule.itemprop, rule.itemtype, false)}`;
    });

    return isNestedCall
        ? `<div>${objectHtml.join('')}</div>`
        : `<div itemprop="${itemProp}">${objectHtml.join('')}</div>`;
}

/**
 * Converts the given string into microdata.
 * E.g. the following string 'string1' will be transformed into this:
 * ```html
 * <span itemprop="some-item-prop">
 *     string1
 * </span>
 * ```
 * @param {unknown} newVal
 * @param {string} itemProp
 * @param {StringValue} valueType
 * @returns {string}
 */
function convertStringType(newVal: unknown, itemProp: string, valueType: StringValue): string {
    if (typeof newVal !== 'string') {
        throw createError('O2M-RTYC1', {
            itemprop: itemProp,
            type: valueType.type,
            val: newVal
        });
    }

    if (valueType.regexp && !new RegExp(valueType.regexp).test(newVal)) {
        throw createError('O2M-RTYC3', {
            itemprop: itemProp,
            regexp: valueType.regexp,
            val: newVal
        });
    }

    return escapeForHtml(newVal.toString());
}

/**
 * Converts the given integer into microdata.
 * E.g. the following integer 1 will be transformed into this:
 * ```html
 * <span itemprop="some-item-prop">
 *     1
 * </span>
 * ```
 * @param {unknown} newVal
 * @param {string} itemProp
 * @param {IntegerValue} valueType
 * @returns {string}
 */
function convertIntegerType(newVal: unknown, itemProp: string, valueType: IntegerValue): string {
    if (!Number.isInteger(newVal)) {
        throw createError('O2M-RTYC1', {
            itemprop: itemProp,
            type: valueType.type,
            val: newVal
        });
    }

    return escapeForHtml(stringify(newVal));
}

/**
 * Converts the given number into microdata.
 * E.g. the following number 2 will be transformed into this:
 * ```html
 * <span itemprop="some-item-prop">
 *     2
 * </span>
 * ```
 * @param {unknown} newVal
 * @param {string} itemProp
 * @param {NumberValue} valueType
 * @returns {string}
 */
function convertNumberType(newVal: unknown, itemProp: string, valueType: NumberValue): string {
    if (typeof newVal !== 'number') {
        throw createError('O2M-RTYC1', {
            itemprop: itemProp,
            type: valueType.type,
            val: newVal
        });
    }

    return escapeForHtml(stringify(newVal));
}

/**
 * Converts the given boolean into microdata.
 * E.g. the following boolean 'true' will be transformed into this:
 * ```html
 * <span itemprop="some-item-prop">
 *     true
 * </span>
 * ```
 * @param {unknown} newVal
 * @param {string} itemProp
 * @param {BooleanValue} valueType
 * @returns {string}
 */
function convertBooleanType(newVal: unknown, itemProp: string, valueType: BooleanValue): string {
    if (typeof newVal !== 'boolean') {
        throw createError('O2M-RTYC1', {
            itemprop: itemProp,
            type: valueType.type,
            val: newVal
        });
    }

    return escapeForHtml(stringify(newVal));
}

/**
 * Converts the given reference into microdata.
 * E.g. the following reference 'dd005c5a25fac365f2d72a113a754a561a9a587530b5a2f1d1ae0ec3874cf5c3'
 * will be transformed into this:
 * ```html
 * <a itemprop="some-item-prop" href
 * ="dd005c5a25fac365f2d72a113a754a561a9a587530b5a2f1d1ae0ec3874cf5c3">
 * dd005c5a25fac365f2d72a113a754a561a9a587530b5a2f1d1ae0ec3874cf5c3
 * </a>
 * ```
 * @param {unknown} newVal
 * @param {string} itemProp
 * @returns {string}
 */
function convertReferenceType(newVal: unknown, itemProp: string): string {
    // Check hash format validity: While this is an additional cost writing a string
    // that is not a hash would only get caught with an obscure "could not parse" error
    // when trying to read such an object, because the microdata-to-object parser
    // expects these links to be of exactly the fixed size of a hash (64 characters for
    // SHA-256).
    if (!isHash(newVal)) {
        throw createError('O2M-RTYC4', {itemprop: itemProp, val: newVal});
    }

    return escapeForHtml(stringify(newVal));
}

/**
 * @static
 * @param {RecipeRule} type
 * @returns {"obj" | "id" | "clob" | "blob" | void}
 */
export function getHashLinkTypeFromRule(type: ValueType['type']): HashLinkTypeNames | void {
    return type === 'referenceToObj'
        ? HashLinkType.OBJ
        : type === 'referenceToId'
          ? HashLinkType.ID
          : type === 'referenceToBlob'
            ? HashLinkType.BLOB
            : type === 'referenceToClob'
              ? HashLinkType.CLOB
              : undefined;
}

/**
 * Checks that the value of an object property fits the ONE object's recipe's `valueType` property,
 * or `string` if no `valueType` was specified in the recipe.
 * @private
 * @param {*} newVal
 * @param {RecipeRule.itemprop} itemProp
 * @param {ValueType} [valueType={type: 'string'}]
 * @param {boolean} isNestedCall
 * @returns {undefined}
 */
export function convertValueByType(
    newVal: unknown,
    itemProp: RecipeRule['itemprop'],
    valueType: ValueType = {type: 'string'},
    isNestedCall: boolean = false
): string {
    const itemPropAttribute = isNestedCall ? '' : ` itemprop="${itemProp}"`;

    /**
     * Appends the itemprop string to the microdata if it's needed (nested or not)
     * @param {string} val
     * @returns {string}
     */
    function outerSpanTagIfNotNested(val: string): string {
        return isNestedCall ? val : `<span itemprop="${itemProp}">${val}</span>`;
    }

    let val;

    switch (valueType.type) {
        case 'string': {
            val = convertStringType(newVal, itemProp, valueType);
            return outerSpanTagIfNotNested(val);
        }
        case 'integer': {
            val = convertIntegerType(newVal, itemProp, valueType);
            return outerSpanTagIfNotNested(val);
        }
        case 'number':
            val = convertNumberType(newVal, itemProp, valueType);
            return outerSpanTagIfNotNested(val);
        case 'boolean':
            val = convertBooleanType(newVal, itemProp, valueType);
            return outerSpanTagIfNotNested(val);
        case 'stringifiable':
            val = escapeForHtml(stringify(newVal));
            return outerSpanTagIfNotNested(val);
        case 'referenceToObj':
        case 'referenceToId':
        case 'referenceToClob':
        case 'referenceToBlob':
            val = convertReferenceType(newVal, itemProp);
            return isNestedCall
                ? `<a data-type="${getHashLinkTypeFromRule(valueType.type)}">${newVal}</a>`
                : `<a${itemPropAttribute} data-type="${getHashLinkTypeFromRule(
                      valueType.type
                  )}">${newVal}</a>`;
        case 'map':
            val = convertMapType(newVal, itemProp, valueType);
            return `<dl${itemPropAttribute}>${val}</dl>`;
        case 'bag':
            val = convertBagType(newVal, itemProp, valueType);
            return `<ul${itemPropAttribute}>${val}</ul>`;
        case 'array':
            val = convertArrayValueType(newVal, itemProp, valueType);
            return `<ol${itemPropAttribute}>${val}</ol>`;
        case 'set':
            val = convertSetType(newVal, itemProp, valueType);
            return `<ul${itemPropAttribute}>${val}</ul>`;
        case 'object':
            return convertNestedObjectType(newVal, itemProp, valueType, isNestedCall);
        default:
            return '';
    }
}

/**
 * Called by convertObject and convertedNestedObject for each "itemprop" for which there is a
 * rule. There may be such a property in the given object or not, here we deal with whatever we
 * find, using the information in the recipe-rule which tells us what we are supposed to find.
 * @private
 * @param {RecipeRule} rule - Link to the recipe to use (defined in this module above). The rule
 * is expected to **have inheritance already resolved** (property `inheritFrom`)
 * @param {Array<(string|number|object|OneObjectTypes)>} val
 * @returns {string}
 * @throws {Error}
 */
export function convertValue(rule: Readonly<RecipeRule>, val: unknown): string {
    // If there is no value for a rule in the recipe then we simply leave out the output for that
    // rule. If this is an ID or a non-optional property a missing value is an error.
    if (val === undefined || val === null) {
        // Using an explicit check for clarity, the variable is "boolean | undefined".
        if (rule.optional !== true) {
            throw createError('O2M-RTYC2', {itemprop: rule.itemprop, rule});
        }

        return '';
    }

    // Since Javascript has no "Bag" type we expect an Array for both "array" and "bag".
    if (
        rule.itemtype !== undefined &&
        (rule.itemtype.type === 'array' || rule.itemtype.type === 'bag') &&
        !Array.isArray(val)
    ) {
        throw createError('O2M-CVAL4', {itemprop: rule.itemprop, rule, val});
    }

    // A single value of type string, number, boolean, regexp, or object. The first four
    // have a usable toString() method, objects have to be stringified.
    return convertValueByType(val, rule.itemprop, rule.itemtype);
}

/**
 * Converts the data for one given ONE object type to microdata by iterating over all rules of
 * the object-type's rule-set for the given type. Note: This means that properties not mentioned
 * in the rule set are simply ignored.
 *
 * Call scenarios:
 *
 * - 1st call: for the overall (outer) object upon start of the conversion process for a given
 * object. Its span-tag frame has no "itemprop".
 *
 * - n-th call(s) (2-step recursive): When inside an object and a property with an included
 * object is discovered as its value. In this case "itemprop" is set to the name of the property
 * the included object is assigned to. The outer <span> frame created for the (sub-) object now
 * gets an attribute <code>itemprop="${itemprop}"</code>.
 *
 *   A) The included object is of any type but "Reference".
 *   B) The included object is of type "Reference", in which case it points to another object and
 *      there are two sub-options:
 *      B.1) Either the reference is a reference, or
 *      B.2) it has been "imploded" and the actual object is included in its place.
 *
 * @private
 * @param {OneObjectTypes} obj
 * @param {string} itemprop - This property is set for included objects assigned to a property
 * of a higher-level object.
 * @param {boolean} [makeIdObject=false] - If set to true only rules marked as ID-object rules are
 * used, so the resulting microdata can be used to calculate an ID hash. This also adds an
 * attribute `data-id-object="true"` to the opening outer `<span>` tag so that we get
 * a different SHA-256 compared to the one we would get for the same object, with the same
 * data properties, but as a normal (non-ID) ONE object.
 * @returns {string}
 * @throws {(Error|Error)}
 */
function convertObject(
    obj: OneObjectTypes | OneIdObjectTypes,
    itemprop: string,
    makeIdObject: boolean = false
): string {
    // The function can be told to create an ID object from a normal one. This way we don't need
    // an extra step of creating a temporary ID-object for any given (full) ONE object on the
    // way to creating an ID hash. By only using ID rules we can use the regular object and
    // because we use the rules to parse the object instead of iterating over all existing
    // object properties all non-ID properties are simply ignored.
    function filterRulesIfIdObj(rules: RecipeRule[]): RecipeRule[] {
        // Not "resolveRuleInheritanceInNestedType(rule)" but "rule" - inherited isId is ignored, ID properties
        // must be defined in the actual recipe and cannot be inherited.
        return makeIdObject ? rules.filter(rule => rule.isId) : rules;
    }

    const rules = filterRulesIfIdObj(getRecipe(obj.$type$).rule);

    // This can happen if we are told to create an ID object but there are no ID rules because the
    // object type is for unversioned objects only. This is a developer error, i.e. it does not
    // depend on user data, only on the code.
    if (makeIdObject && rules.length === 0) {
        throw createError('O2M-COBJ1', {obj});
    }

    // This is used to find properties that are in the object but for which there is no rule in
    // the recipe. Such superfluous properties are reported as errors. If we didn't report it we
    // would just ignore those properties and users (developers)  might be surprised - much later -
    // that data they thought was saved was indeed just ignored.
    // When making an ID object we ignore anything but ID properties though.
    const objProperties = makeIdObject ? new Set() : new Set(Reflect.ownKeys(obj));
    // This ONE object meta property will always be there but never be part of the rules
    objProperties.delete('$type$');
    // This ONE object meta property will sometimes be there but never be part of the rules
    objProperties.delete('$versionHash$');

    const microdata = [
        '<div' +
            // The outermost frame enclosing the ONE object does not have an "itemprop" attribute,
            // but an included object does have this attribute in its outer frame.
            (itemprop === '' ? '' : ` itemprop="${itemprop}"`) +
            // What (string) we use does not really matter, but when creating microdata for an ID
            // object we want a different result for the string compared to the microdata of an actual
            // versioned ONE object with only ID properties. The resulting SHA-256 hash now differs
            // from the one we get for that real object. This keeps ID objects (and hashes) "virtual".
            (makeIdObject ? ' ' + ID_OBJECT_ATTR : '') +
            ' itemscope itemtype="//refin.io/' +
            obj.$type$ +
            '">',

        // The string between the enclosing <span ....>...</span> tags with the actual data.
        // NOTE #1: Instead of iterating over the data we iterate over the rules. The (ordered -
        // array of) rules determines the order of properties in the microdata string.
        // NOTE #2: for-loops still are faster than array.map. The other reason to use an
        // "old-fashioned" loop construct is that we can put more into it without the code appearing
        // as "unclean".
        ...rules.map(rule => {
            objProperties.delete(rule.itemprop);
            return convertValue(
                resolveRuleInheritance(rule),
                obj[rule.itemprop as keyof typeof obj]
            );
        }),

        '</div>'
    ].join('');

    if (objProperties.size > 0) {
        throw createError('O2M-COBJ2', {objProperties, obj});
    }

    return microdata;
}

/**
 * Convert the Javascript object representation of a ONE object to microdata following the
 * rules in object-recipes.js. An exception is thrown if there is a problem during the conversion.
 * **Note** Any property not found in a rule is ignored - we iterate over the rules and
 * then check for a property on the object. Also ignored are rules marked as *optional* if there
 * indeed is no data for them.
 * @static
 * @param {OneObjectTypes} obj - A Javascript object describing a ONE object
 * @returns {string} Microdata representation of the object
 * @throws {Error} Throws an `Error` if the mandatory object parameter is missing
 */
export function convertObjToMicrodata(obj: Readonly<OneObjectTypes | OneIdObjectTypes>): string {
    if (!isObject(obj)) {
        throw createError('O2M-CONV', {obj});
    }

    return convertObject(obj, '', false);
}

/**
 * Convert the Javascript object representation of a ONE object to ID microdata following the
 * rules in object-recipes.js. An exception is thrown if there is a problem during the conversion.
 * **Note** Any property not found in a rule is ignored - we iterate over the rules and
 * then check for a property on the object. Also ignored are rules marked as *optional* if there
 * indeed is no data for them.
 * @static
 * @param {OneIdObjectTypes} obj - A Javascript object describing a ONE ID object
 * @returns {string} ID Microdata representation of the object
 * @throws {Error} Throws an `Error` if the mandatory object parameter is missing
 */
export function convertObjToIdMicrodata(obj: Readonly<OneIdObjectTypes | OneObjectTypes>): string {
    if (!isObject(obj)) {
        throw createError('O2M-CONV', {obj});
    }

    return convertObject(obj, '', true);
}
