/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module defines the core ONE object types. It has the type definitions as well as the
 * recipes.
 *
 * **The module deliberately does not import any other module.** This ensures that there are no
 * cyclic imports (type imports don't count, they don't exist at runtime).
 * @module
 */

/**
 * A meta-type defined in `one.core/[src|lib]/@OneObjectInterfaces.d.ts` in module namespace
 * `"@OneObjectInterfaces"` that can be extended through TypeScript's
 * {@link https://www.typescriptlang.org/docs/handbook/declaration-merging.html|*declaration merging*} feature to include ONE object definitions defined through recipes of the application.
 *
 * In order to add your own project's unversioned ONE object types create similar .d.ts
 * file, declare a module namespace `@OneObjectInterfaces` and export an interface declaration for
 * `OneUnversionedObjectInterfaces` just as in the one.core file. If you tell `tsc`
 * (TypeScript server) via your `tsconfig.json` to include both one.core's and your own
 * definition files it will merge the declarations into one.
 *
 * To extend this structure have a look at file `one.core/@OneObjectInterfaces.d.ts` and do what
 * was one there to add ONE object types defined for the one.core tests for your own application
 * types.
 *
 * This interface contains the names (as keys) and TypeScript interface types (as values) of
 * all unversioned objects.
 *
 * **Important:** The string keys for each entry must be exactly the ONE object type name as
 * used in the "`name`" property of the recipe for that type.
 * @global
 * @typedef {object} OneUnversionedObjectInterfaces
 * @property {ONE-object-interface-type} type-name - Use the same string literal as used for
 * the "type" property in your ONE object(s) as key and the TypeScript interface definition
 * name as the value
 */
declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Keys: Keys;
        VersionNodeEdge: VersionNodeEdge<OneVersionedObjectTypes>;
        VersionNodeChange: VersionNodeChange<OneVersionedObjectTypes>;
        VersionNodeMerge: VersionNodeMerge<OneVersionedObjectTypes>;
    }
}

/**
 * ONE microdata object properties can store one of these types:
 *
 * - NumberValue
 * - BooleanValue
 * - StringifiableValue
 * - ReferenceToObjValue
 * - ReferenceToIdValue
 * - ReferenceToClobValue
 * - ReferenceToBlobValue
 * - MapValue
 * - BagValue
 * - ArrayValue
 * - SetValue
 * - ObjectValue;
 *
 * Conversion from and to the types is performed upon writing and reading ONE microdata objects:
 *
 * When reading microdata and creating a Javascript object representation of the ONE object
 * the strings will be converted to these types if the respective rule for the item has type
 * information. By default, everything remains a string.
 *
 * @global
 * @typedef {(
 *   StringValue | IntegerValue | NumberValue | BooleanValue | StringifiableValue |
 *   ReferenceToObjValue | ReferenceToIdValue | ReferenceToClobValue | ReferenceToBlobValue |
 *   MapValue | BagValue | ArrayValue | SetValue | ObjectValue
 * )} ValueType
 */
export type ValueType =
    | StringValue
    | IntegerValue
    | NumberValue
    | BooleanValue
    | StringifiableValue
    | ReferenceToObjValue
    | ReferenceToIdValue
    | ReferenceToClobValue
    | ReferenceToBlobValue
    | MapValue
    | BagValue
    | ArrayValue
    | SetValue
    | ObjectValue;

/**
 * This object is part of {@link ValueType} and describes the value-type of a String.
 * @global
 * @typedef {object} StringValue
 * @property {'string'} type
 * @property {RegExp} [regexp]
 */
export interface StringValue {
    type: 'string';
    regexp?: RegExp;
}

/**
 * This object is part of {@link ValueType} and describes the value-type of an Integer.
 * @global
 * @typedef {object} IntegerValue
 * @property {'integer'} type
 * @property {number} [max]
 * @property {number} [min]
 */
export interface IntegerValue {
    type: 'integer';
    max?: number;
    min?: number;
}

/**
 * This object is part of {@link ValueType} and describes the value-type of a Number.
 * @global
 * @typedef {object} NumberValue
 * @property {'number'} type
 * @property {number} [max]
 * @property {number} [min]
 */
export interface NumberValue {
    type: 'number';
    max?: number;
    min?: number;
}

/**
 * This object is part of {@link ValueType} and describes the value-type of a Boolean.
 * @global
 * @typedef {object} BooleanValue
 * @property {'boolean'} type
 */
export interface BooleanValue {
    type: 'boolean';
}

/**
 * This object is part of {@link ValueType} and describes the value-type of a {@link SHA256Hash} of
 * an object.
 * @global
 * @typedef {object} ReferenceToObjValue
 * @property {'referenceToObj'} type
 * @property {Set<OneObjectTypeNames | '*'>} allowedTypes - Includes another recipe as a
 * sub-item. Create microdata span tag for complex data with attributes `itemscope` and
 * `itemtype="//refin.io/{THIS TYPE}"`. The actual values are placed in inner span tags
 * with an itemprop attributeSHA256IdHash. This is a list of acceptable types to include. The
 * itemprop` either is a hash link, or in imploded microdata those objects themselves are
 * included. If the list includes the type string '*' the meaning is "any type".
 */
export interface ReferenceToObjValue {
    type: 'referenceToObj';
    allowedTypes: Set<OneObjectTypeNames | '*'>;
}

/**
 * This object is part of {@link ValueType} and describes the value-type of a {@link
 * SHA256IdHash} of an object.
 * @global
 * @typedef {object} ReferenceToIdValue
 * @property {'referenceToId'} type
 * @property {Set<OneVersionedObjectTypeNames | '*'>} allowedTypes - Same as `referenceToObj`
 * but the hash link points to an ID hash.
 */
export interface ReferenceToIdValue {
    type: 'referenceToId';
    allowedTypes: Set<OneVersionedObjectTypeNames | '*'>;
}

/**
 * This object is part of {@link ValueType} and describes the value-type of a {@link SHA256Hash} of
 * a {@link CLOB}.
 * @global
 * @typedef {object} ReferenceToClobValue
 * @property {'referenceToClob'} type - Same as `referenceToObj` but the hash link points to a
 * CLOB (UTF-8) hash. It also is just a boolean value.
 */
export interface ReferenceToClobValue {
    type: 'referenceToClob';
}

/**
 * This object is part of {@link ValueType} and describes the value-type of a {@link SHA256Hash} of
 * a {@link BLOB}.
 * @global
 * @typedef {object} ReferenceToBlobValue
 * @property {'referenceToBlob'} type - Same as `referenceToObj` but the hash link points to a
 * BLOB hash. It also is just a boolean value.
 */
export interface ReferenceToBlobValue {
    type: 'referenceToBlob';
}

/**
 * This object is part of {@link ValueType} and describes the value-type of a Map Object.
 * @global
 * @typedef {object} MapValue
 * @property {'map'} type
 * @property {PrimitiveValueTypes|ReferenceValueTypes} key
 * @property {ValueType} value
 */
export interface MapValue {
    type: 'map';
    key: PrimitiveValueTypes | ReferenceValueTypes;
    value: ValueType;
}

/**
 * This object is part of {@link ValueType} and describes the value-type of a Bag Object.
 * A "bag" is a data-structure that implements a multiset, which is a set
 * that allows multiple (duplicates). In the microdata the sequence of items is ordered by ONE.
 * @global
 * @typedef {object} BagValue
 * @property {'bag'} type
 * @property {ValueType} item
 */
export interface BagValue {
    type: 'bag';
    item: ValueType;
}

/**
 * This object is part of {@link ValueType} and describes the value-type of an Array Object.
 * @global
 * @typedef {object} ArrayValue
 * @property {'array'} type
 * @property {ValueType} item
 */
export interface ArrayValue {
    type: 'array';
    item: ValueType;
}

/**
 * This object is part of {@link ValueType} and describes the value-type of a Set Object.
 * @global
 * @typedef {object} SetValue
 * @property {'set'} type
 * @property {ValueType} item
 */
export interface SetValue {
    type: 'set';
    item: ValueType;
}

/**
 * This object is part of {@link ValueType} and describes the value-type of an ONE Object.
 * @global
 * @typedef {object} ObjectValue
 * @property {'object'} type
 * @property {RecipeRule[]} rules
 */
export interface ObjectValue {
    type: 'object';
    rules: RecipeRule[];
}

/**
 * @global
 * @typedef {object} StringifiableValue
 * @property {'stringifiable'} type
 */
export interface StringifiableValue {
    type: 'stringifiable';
}

/**
 * @global
 * @typedef {(
 *   StringValue | IntegerValue | NumberValue | BooleanValue | StringifiableValue
 * )} PrimitiveValueTypes
 */
export type PrimitiveValueTypes =
    | StringValue
    | IntegerValue
    | NumberValue
    | BooleanValue
    | StringifiableValue;

/**
 * @global
 * @typedef {(
 *   ReferenceToObjValue | ReferenceToIdValue | ReferenceToClobValue | ReferenceToBlobValue
 * )} PrimitiveValueTypes
 */
export type ReferenceValueTypes =
    | ReferenceToObjValue
    | ReferenceToIdValue
    | ReferenceToClobValue
    | ReferenceToBlobValue;

/**
 * A meta-type defined in `one.core/@OneObjectInterfaces.d.ts` in module namespace
 * `"@OneObjectInterfaces"` that can be extended through TypeScript's
 * {@link https://www.typescriptlang.org/docs/handbook/declaration-merging.html|*declaration merging*} feature to include ONE object definitions defined through recipes of the application.
 *
 * In order to add your own project's ID ONE object types create similar .d.ts file,
 * declare a module namespace `@OneObjectInterfaces` and export an interface declaration for
 * `OneIdObjectInterfaces` just as in the one.core file. If you tell `tsc` (TypeScript
 * server) via your `tsconfig.json` to include both one.core's and your own definition files
 * it will merge the declarations into one.
 *
 * This interface contains the names (as keys) and TypeScript interface types (as values) of
 * all ID objects. Unless you need to refer to the ID object types by name it probably is
 * best to use TypeScript's built-in `Pick<T, K>` helper to pick the ID object properties
 * from the full versioned object types. Usually only the latter will have named interfaces.
 * If necessary, in .ts code files you can always refer to ID object interfaces using
 * `OneIdObjectInterfaces[TypeId]`, where `TypeId` is the appropriate string key. For key
 * names one.core follows the rule to take the name of the versioned object type and append, for
 * example, 'Id'.
 *
 * **Note** that ID object interfaces are special and must be used explicitly, they are not
 * part in any of the unions or merged definitions of ONE object types.
 * Except for in rare places ID object types are not to be permitted even when the
 * respective versioned object types are, because the ID object types may miss properties
 * that are not ID properties but still non-optional. ID objects are only used to calculate
 * ID hashes and never written, nor should they be used for processing.
 *
 * That is why the name (key) you choose for the ID object type may be arbitrary, it is not
 * used as type name. Only the values are used, i.e. the ID object declarations.
 *
 * This key/value interface still is necessary, the declarations cannot just be written
 * directly to `OneIdObjectTypes`: Declaration merging of ID object types declared for the
 * application requires this key/value structure.
 * @global
 * @typedef {object} OneIdObjectInterfaces
 * @property {ONE-object-interface-type} type-name - Use the same string literal as used for
 * the "$type$" property in your ONE object(s) as key and the TypeScript interface definition
 * name as the value
 */
declare module '@OneObjectInterfaces' {
    // eslint-disable-next-line no-undef -- OneCrdtIdObjectInterfaces *is* defined
    export interface OneIdObjectInterfaces {
        Access: Pick<Access, '$type$' | 'object'>;
        Chum: Pick<Chum, '$type$' | 'name' | 'instance' | 'person'>;
        Group: Pick<Group, '$type$' | 'name'>;
        IdAccess: Pick<IdAccess, '$type$' | 'id'>;
        Instance: Pick<Instance, '$type$' | 'name' | 'owner'>;
        Person: PersonId;
        Recipe: Pick<Recipe, '$type$' | 'name'>;
    }
}

/**
 * A meta-type defined in `one.core/@OneObjectInterfaces.d.ts` in module namespace
 * `"@OneObjectInterfaces"` that can be extended through TypeScript's
 * {@link https://www.typescriptlang.org/docs/handbook/declaration-merging.html|*declaration merging*} feature to include ONE object definitions defined through recipes of the application.
 *
 * In order to add your own project's versioned ONE object types create similar .d.ts
 * file, declare a module namespace `@OneObjectInterfaces` and export an interface declaration for
 * `OneVersionedObjectInterfaces` just as in the one.core file. If you tell `tsc`
 * (TypeScript server) via your `tsconfig.json` to include both one.core's and your own
 * definition files it will merge the declarations into one.
 *
 * This interface contains the names (as keys) and TypeScript interface types (as values) of
 * all versioned objects.
 *
 * **Important:** The string keys for each entry must be exactly the ONE object type name as
 * used in the "`name`" property of the recipe for that type.
 * @global
 * @typedef {object} OneVersionedObjectInterfaces
 * @property {ONE-object-interface-type} type-name - Use the same string literal as used for
 * the "$type$" property in your ONE object(s) as key and the TypeScript interface definition
 * name as the value
 */
declare module '@OneObjectInterfaces' {
    export interface OneVersionedObjectInterfaces {
        Access: Access;
        Chum: Chum;
        Group: Group;
        IdAccess: IdAccess;
        Instance: Instance;
        Person: Person;
        Recipe: Recipe;
    }
}

/**
 * Defined in one.core's `@OneObjectInterfaces.d.ts` file, this is the result of merging the
 * declarations of {@link OneUnversionedObjectInterfaces}, {@link OneVersionedObjectInterfaces}.
 *
 * This is a key/value map object where the keys are *all* valid ONE object type names, and the
 * values are the interface type (i.e. ONE object) definitions.
 *
 * ID object interface definitions are not included in this map because except for in rare
 * places ID object types are not to be permitted even when the respective versioned object
 * types are, because the ID object types may miss properties that are not ID properties but
 * still non-optional. ID objects are only used to calculate ID hashes and never written,
 * nor should they be used for processing.
 * @global
 * @typedef {object} OneObjectInterfaces
 */
export type OneObjectInterfaces = OneUnversionedObjectInterfaces & OneVersionedObjectInterfaces;

/**
 * This union is obtained by extracting all keys from {@link OneUnversionedObjectInterfaces}.
 * @global
 * @typedef {"Keys" | AllYourUnversionedTypeNames} OneUnversionedObjectTypeNames
 */
export type OneUnversionedObjectTypeNames = keyof OneUnversionedObjectInterfaces;

/**
 * This union is obtained by extracting all values from {@link OneUnversionedObjectInterfaces}.
 * @global
 * @typedef {Keys | AllYourUnversionedTypes} OneUnversionedObjectTypes
 */
export type OneUnversionedObjectTypes =
    OneUnversionedObjectInterfaces[keyof OneUnversionedObjectInterfaces];

/**
 * This union is obtained by extracting all keys from {@link OneVersionedObjectInterfaces}.
 * @global
 * @typedef {
 *     "Access" | "Chum" | "Group" | "Instance" | "Person" | "Recipe" |
 *     AllYourVersionedTypeNames
 * } OneVersionedObjectTypeNames
 */
export type OneVersionedObjectTypeNames = keyof OneVersionedObjectInterfaces;

/**
 * This union is obtained by extracting all values from {@link OneVersionedObjectInterfaces}.
 * @global
 * @typedef {
 *     Access | Chum | Group | IdAccess | Instance | Person | Recipe |
 *     AllYourVersionedTypes
 * } OneVersionedObjectTypes
 */
export type OneVersionedObjectTypes =
    OneVersionedObjectInterfaces[keyof OneVersionedObjectInterfaces];

/**
 * This union is obtained by extracting all values from {@link OneIdObjectInterfaces}.
 * @global
 * @typedef {
 *   AccessId | ChumId | GroupId | InstanceId | PersonId | RecipeId |
 *   AllYourIdObjectTypes
 * } OneIdObjectTypes
 */
export type OneIdObjectTypes = OneIdObjectInterfaces[keyof OneIdObjectInterfaces];

/**
 * The union of all "`name`" property values of all {@link Recipe}s used by one.core and the
 * application. The type is created as union of {@link OneUnversionedObjectTypeNames} and
 * {@link OneVersionedObjectTypeNames}.
 * @global
 * @typedef {OneUnversionedObjectTypeNames|OneVersionedObjectTypeNames} OneObjectTypeNames
 */
export type OneObjectTypeNames = OneUnversionedObjectTypeNames | OneVersionedObjectTypeNames;

/**
 * The union of all interfaces of ONE object types used by one.core and the application. The
 * type is created as union of {@link OneUnversionedObjectTypes} and
 * {@link OneVersionedObjectTypes}.
 * @global
 * @typedef {OneUnversionedObjectTypes | OneVersionedObjectTypes} OneObjectTypes
 */
export type OneObjectTypes = OneUnversionedObjectTypes | OneVersionedObjectTypes;

/**
 * The ID object of a Person with only "email" as the sole ID property of {@link Person}
 * objects.
 * @typedef {object} PersonId
 * @property {'Person'} $type$
 * @property {string} email
 */
export type PersonId = Pick<Person, '$type$' | 'email'>;

/**
 * This is a *virtual type* representing BLOB files. It is used as a generic parameter type
 * for {@link SHA256Hash} and {@link SHA256IdHash}.
 * @global
 * @typedef {object} BLOB
 */
export interface BLOB {
    _: 'BLOB';
}

/**
 * This is a *virtual type* representing CLOB (UTF-8 text) files. It is used as a generic
 * parameter type for {@link SHA256Hash} and {@link SHA256IdHash}.
 * @global
 * @typedef {object} CLOB
 */
export interface CLOB {
    _: 'CLOB';
}

/**
 * The union of all "`name`" property values of all {@link Recipe}s used by one.core and the
 * application plus 'BLOB' for binary objects and 'CLOB' for UTF-8 objects.
 * @global
 * @typedef {OneObjectTypeNames|BLOB|CLOB} HashTypes
 */
export type HashTypes = OneObjectTypes | BLOB | CLOB;

/**
 * There are two Access objects that are identical in structure and purpose except for in name:
 * 'Access' points to immutable graphs.
 *
 * ### Example
 *
 * Javascript representation:
 *
 * ```javascript
 * const obj = {
 *     $type$: 'Access',
 *     object: hash,
 *     person: [personIdHash]
 * };
 * ```
 *
 * HTML microdata representation:
 *
 * ```html
 * <div itemscope itemtype="//refin.io/Access">
 *   <a itemprop="object" href="${hash}">${hash}</a>
 *   <a itemprop="person" href="${personIdHash}">${personIdHash}</a>
 * </div>
 * ```
 * @global
 * @typedef {object} Access
 * @property {'Access'} type Fixed string 'Access'
 * @property {SHA256Hash} object A versioned or unversioned object link to a concrete
 * versioned or unversioned object that the access rights are being set for.
 * @property {SHA256IdHash[]} [person] An array of ID references to Person objects.
 * @property {SHA256IdHash[]} [group] An array of ID references to Group objects. *Only
 * the latest version* of a group is granted access!
 */
export interface Access {
    $type$: 'Access';
    object: SHA256Hash;
    person: Array<SHA256IdHash<Person>>;
    group: Array<SHA256IdHash<Group>>;
}

/**
 * Same as {@link Access|Access object} but instead of a reference to a concrete object it
 * has a reference to an ID object of a versioned object and grants access to all current *and
 * future* versions of the object.
 * @global
 * @typedef {object} IdAccess
 * @property {'IdAccess'} $type$ Fixed string 'IdAccess' (which is mutable, since the ID
 * reference also points to any future versions of the object) depending on if the directed
 * graph of ONE objects it points to an ID object.
 * @property {SHA256IdHash} id A reference to all versions of an ID object that the access
 * rights are being set for.
 * @property {SHA256IdHash[]} [person] An array of ID references to Person objects.
 * @property {SHA256IdHash[]} [group] An array of ID references to Group objects. *Only
 * the latest version* of a group is granted access!
 */
export interface IdAccess {
    $type$: 'IdAccess';
    id: SHA256IdHash;
    person: Array<SHA256IdHash<Person>>;
    group: Array<SHA256IdHash<Group>>;
}

/**
 * This type is included in {@link Chum} objects as well as used internally.
 * The numbers are without network overhead. The number of sent requests always includes the
 * connect request, so after communication finished both parties will have sent one more request
 * than they themselves received, since the connect request is to the communication server!
 * @global
 * @typedef {object} WebsocketStatistics
 * @property {number} requestsSentTotal Total number of requests made thus far
 * @property {number} requestsReceivedTotal Total number of requests received thus far
 * @property {number} requestsReceivedInvalid Total number of requests received that had to be
 * ignored because they were either unparsable (invalid JSON) or otherwise unusable
 */
export interface WebsocketStatistics {
    requestsSentTotal: number;
    requestsReceivedTotal: number;
    requestsReceivedInvalid: number;
}

/**
 * A Chum object defines a filter for exchanging data with other instances.
 * Initially it only filters by persons.
 *
 * ### Example
 *
 * ```html
 * <div itemscope itemtype="//refin.io/Chum">
 *   <span itemprop="name">ThisChumsName</span>
 *   <span itemprop="instance">${name1}</span>
 *   <span itemprop="instance">${name2}</span>
 *   <span itemprop="person">${hash1}</span>
 *   <span itemprop="person">${hash2}</span>
 *   <span itemprop="highestRemoteTimestamp">${timestamp1}</span>
 *   ...
 * </span>
 * ```
 * @global
 * @typedef {object} Chum
 * @property {'Chum'} $type$ - Fixed string 'Chum'
 * @property {string} name
 * @property {string[]} instance - A pair of instance names
 * @property {SHA256IdHash[]} person - A pair of Person ID hashes. The first one is the one the
 * local instance (owner of the Chum object) used for authentication to the remote instance,
 * the second one is the one the remote instance used to do the same for the local instance.
 * @property {number} highestRemoteTimestamp - A numeric timestamp specifying a date-time on
 * the remote system. We can be sure to have all objects accessible to us created or made
 * accessible to us before that time. NOTE: If older objects are made accessible it
 * will be through an object created at a later time. Since this cutoff date-time specifies
 * the root node of an accessible directed graph, which by necessity (hash links!) has to be
 * created after all others, we get older objects linked from such a root node in any case.
 * This timestamp is only used to filter root nodes.
 * @property {Array<SHA256Hash>} AtoBObjects - Record of all transfers from A to B
 * @property {Array<SHA256IdHash>} AtoBIdObjects - Record of all ID transfers from A to B
 * @property {Array<SHA256Hash>} AtoBBlob - Record of all BLOB transfers from A to B
 * @property {Array<SHA256Hash>} AtoBClob - Record of all CLOB transfers from A to B
 * @property {Array<SHA256Hash>} BtoAObjects - Record of all transfers from B to A
 * @property {Array<SHA256IdHash>} BtoAIdObjects - Record of all ID transfers from B to A
 * @property {Array<SHA256Hash>} BtoABlob - Record of all BLOB transfers from B to A
 * @property {Array<SHA256Hash>} BtoAClob - Record of all CLOB transfers from B to A
 * @property {number} BtoAExists - How many hashes we already had and did not need to import
 * @property {ErrorWithCode[]} errors - Record of exceptions encountered while running
 * @property {WebsocketStatistics} [statistics] - Data about the exchange such as bytes
 * sent/received
 */
export interface Chum {
    $type$: 'Chum';
    name: string;
    instance: [string, string];
    person: [SHA256IdHash<Person>, undefined | SHA256IdHash<Person>];
    highestRemoteTimestamp: number;
    AtoBObjects: SHA256Hash[];
    AtoBIdObjects: SHA256IdHash[];
    AtoBBlob: Array<SHA256Hash<BLOB>>;
    AtoBClob: Array<SHA256Hash<CLOB>>;
    BtoAObjects: SHA256Hash[];
    BtoAIdObjects: SHA256IdHash[];
    BtoABlob: Array<SHA256Hash<BLOB>>;
    BtoAClob: Array<SHA256Hash<CLOB>>;
    BtoAExists: number;
    errors: ErrorWithCode[];
    statistics?: WebsocketStatistics;
}

/**
 * {@link Access|Access} objects link to `Group` objects to grant access rights.
 *
 * ### Example
 *
 * Javascript representation:
 *
 * ```javascript
 * const obj = {
 *     $type$: 'Group',
 *     name: name,
 *     person: [Person1-idHash, Person2-idHash]
 * };
 * ```
 *
 * HTML microdata representation:
 *
 * ```html
 * <span itemprop="item" itemscope itemtype="//refin.io/Group">
 *   <span itemprop="name">${name}</span>
 *   <span itemprop="person">${Person1-ID-hash}</span>
 *   <span itemprop="person">${Person2-ID-hash}</span>
 * </span>
 * ```
 * @global
 * @typedef {object} Group
 * @property {'Group'} $type$ - Fixed string 'Group'
 * @property {string} name
 * @property {SHA256IdHash[]} person
 *
 */
export interface Group {
    $type$: 'Group';
    name: string;
    person: Array<SHA256IdHash<Person>>;
}

/**
 * An Instance object describes one instance of the app. Multiple instances can co-exist on
 * one, and even in the same disk space. Both instances would share the same directory and
 * much of their respective data.
 *
 * The encryption key pair is generated by TweetNaCl.js and is stored in two Base 64 encoded
 * strings:
 *  - Base 64 character set: {@link https://tools.ietf.org/html/rfc4648#section-4}
 *  - Base 64 length: {@link https://stackoverflow.com/q/13378815/544779}
 *  - TweetNaCl length is n=32 bytes
 *  - Base 64 encoded length: Math.ceil(4 * n/3) => 43, plus trailing "=" padding character
 *  for a total length of 44 characters.
 *
 * ### Example
 *
 * Javascript representation:
 *
 * ```javascript
 * const obj = {
 *     $type$: 'Instance',
 *     name: 'InstanceName',
 *     owner: personIdHash,
 *     publicKey: blobHash,
 *     secretKey: blobHash,
 *     module: [moduleHash]
 * };
 * ```
 *
 * HTML microdata representation:
 *
 * ```html
 * <div itemscope itemtype="//refin.io/Instance">
 *   <div itemscope="name">InstanceName</span>
 *   <span itemprop="owner">${personIdHash}</span>
 *   <span itemprop="publicKey">${publicKey}</span>
 *   <a itemprop="module" href="${moduleHash}">${module1-hash}</a>
 * </span>
 * ```
 * @global
 * @typedef {object} Instance
 * @property {'Instance'} $type$
 * @property {string} name - The name of the instance chosen by the user
 * @property {SHA256IdHash} owner - A reference to a Person ID object
 * @property {Set} recipe - A Set of ONE object recipe hash links
 * @property {Map<OneObjectTypeNames,null|Set<string>>} enabledReverseMapTypes - A Map
 * object with ONE object type names as keys and an array of "itemprop" properties from the
 * recipe for that particular ONE object type for which  reverse maps should be written. For
 * all other types and/or properties not mentioned in this Map reverse map entries are not
 * created.
 * @property {Map<OneObjectTypeNamesForIdObjects,null|Set<string>>}
 * enabledReverseMapTypesForIdObjects - A Map object with ONE object type names as keys and an
 * array of "itemprop" properties from the recipe for that particular ONE object type for which
 * ID object reverse maps should be written. For all other types and/or properties not mentioned
 * in this Map reverse map entries are not created.
 */
export interface Instance {
    $type$: 'Instance';
    name: string;
    owner: SHA256IdHash<Person>;
    recipe: Set<SHA256Hash<Recipe>>;
    enabledReverseMapTypes: Map<OneObjectTypeNames, Set<string>>;
    enabledReverseMapTypesForIdObjects: Map<OneVersionedObjectTypeNames, Set<string>>;
}

/**
 * This object stores the *public* encryption and sign keys for a given {@link Instance} or
 * {@link Person} ID. The secret keys are stored in a special non-shared private storage area.
 * @global
 * @typedef {object} Keys
 * @property {'Keys'} $type$
 * @property {SHA256IdHash} owner
 * @property {HexString} publicKey
 * @property {HexString} publicSignKey
 */
export interface Keys {
    $type$: 'Keys';
    owner: SHA256IdHash<Instance | Person>;
    publicKey: HexString;
    publicSignKey: HexString;
}

/**
 * ### Example
 *
 * Javascript representation:
 *
 * ```javascript
 * const obj = {
 *     $type$: 'Person',
 *     email: 'members@gmx.net',
 *     name: 'Foo Test'
 * };
 * ```
 *
 * HTML microdata representation:
 *
 * ```html
 * <div itemscope itemtype="//refin.io/Person">
 *   <span itemprop="email">members@gmx.net</span>
 * </span>
 * ```
 * @global
 * @typedef {object} Person
 * @property {'Person'} $type$
 * @property {string} email - A person-identifying unique email address
 * @property {string} [name]
 */
export interface Person {
    $type$: 'Person';
    email: string;
    name?: string;
}

/**
 * The array of rules determines the properties of the ONE object and their order (in the
 * written microdata representation).
 *
 * ### Example
 *
 * Javascript representation:
 *
 * ```javascript
 * const obj = {
 *     $type$: 'Recipe',
 *     name: ONE-object-type-name,
 *     version: 1,
 *     rule: [
 *         {
 *             itemprop: property1-name
 *             isId: true
 *             valueType: 'number'
 *         },
 *         {
 *             itemprop: property2-name,
 *             regexp: /^[\w]*+$/
 *         },
 *         {
 *             itemprop: property3-name
 *             valueType: 'map'
 *         },
 *         {
 *             itemprop: property4-name
 *             referenceToObj: new Set(['*'])
 *         }
 *     ]
 * };
 * ```
 *
 * HTML microdata representation:
 *
 * ```html
 * <div itemscope itemtype="//refin.io/Recipe">
 *   <span itemprop="name">${ONE-object-type-name}</span>
 *   <span itemprop="rule">
 *     <span itemprop="itemprop">${property1-name}</span>
 *     <span itemprop="isId">true</span>
 *     <span itemprop="valueType">number</span>
 *   </span>
 *   <span itemprop="rule">
 *     <span itemprop="itemprop">${property2-name}</span>
 *   </span>
 *   <span itemprop="rule">
 *     <span itemprop="itemprop">${property3-name}</span>
 *     <span itemprop="valueType">Map</span>
 *   </span>
 *   <span itemprop="rule">
 *     <span itemprop="itemprop">${property4-name}</span>
 *     <span itemprop="referenceToObj">['*']</span>
 *   </span>
 * </span>
 * ```
 * @global
 * @typedef {object} Recipe
 * @property {'Recipe'} $type$
 * easily load a specific version of this versioned Recipe object.
 * @property {string} name The type-string constant identifying this ONE object type
 * @property {RecipeRule[]} rule Array of rules
 */
export interface Recipe {
    $type$: 'Recipe';
    name: OneObjectTypeNames;
    rule: RecipeRule[];
    crdtConfig?: Map<string, string>;
}

/**
 * Important note (from @sebastian). I decided to keep exclude 'list' even if we don't have
 * the list field anymore in {@link RecipeRule}. It will remove 'array','bag' or 'set' field in
 * the {@link RecipeRule.itemtype} and keep only the item type.
 *
 *
 * The recipe-rule property "inheritFrom" can be either a string (common inheritance) or an
 * object (inheritance with additional options). This is the type of the object in the latter case.
 * @global
 * @typedef {object} RuleInheritanceWithOptions
 * @property {string} rule - The rule to inherit from as "." separated path Recipe.itemprop
 * @property {'CollectionItemType' | 'MapItemType'} extract - Extracts the item type inside a
 * collection or map.
 */
export interface RuleInheritanceWithOptions {
    rule: string;
    extract: 'CollectionItemType' | 'MapItemType';
}

/**
 * This object is part of {@link Recipe} but has an extra type because the rule objects  appear
 * on their own in parts of the code, where those rules are given to functions to process parts
 * of ONE objects.
 *
 * NOTE: If this type is updated don't forget to also update function `ensureRecipeRule()` in
 * <PROJECT_HOME>/src/util/recipe-checks.js
 * @global
 * @typedef {object} RecipeRule
 * @property {string} itemprop - Create a microdata span tag with attribute "itemprop".
 * Equivalent to the "key" in a Javascript object literal. The equivalent of the "value"
 * is, again similar to a JS object, either another object (recursion: see "referenceToObj"
 * below) or an actual value (string).
 * @property {boolean} [isId=false] - Whether this is an ID field for this type. If not present
 * "false" is assumed.
 * @property {ValueType} [type] - The Javascript type of this property: After
 * reading microdata everything is a "string". Setting this to {@link ValueType}
 * lets the Microdata => (JS) Object converter know that it has to convert the strings to these
 * types. The default is "string", because everything already is a string anyway when stored as
 * HTML microdata.
 * @property {RecipeRule[]} [object] - An array of {@link RecipeRule} rules for a nested data
 * property. It works just like including a full ONE object on a `referenceToObj` enabled
 * property but without using an actual ONE object, only the data.
 * @property {(string|RuleInheritanceWithOptions)} [inheritFrom] - Inherit properties from the
 * given rule. The current rule inherits all properties of the linked rule and can override them
 * or add to them with its own properties. In the simple case it is a string of the for
 * Recipe[.itemprop].itemprop pointing to an itemprop in any known recipe. Recipe resolution
 * happens at runtime, when "inheritFrom" is encountered for the first time in a recipe rule.
 * The second case with options requires an object of the form {@link RuleInheritanceWithOptions}.
 *
 * ### Example
 *
 * Javascript representation:
 *
 * ```javascript
 * const obj = {
 *     itemprop: propertyValue,
 *     isId: true,
 *     list: 'array',
 *     valueType: {number: {max: 1000}}
 * };
 * ```
 *
 * HTML microdata representation:
 *
 * ```html
 * // Part of a "Recipe" object: Array of RecipeRule in property "rule"
 * ...
 *   <span itemprop="rule">
 *     <span itemprop="itemprop">${propertyValue}</span>
 *     <span itemprop="isId">true</span>
 *     <span itemprop="valueType">"{\"number\":{\"max\":1000}}"</span>
 *   </span>
 * ...
 * ```
 */
export interface RecipeRule {
    itemprop: string;
    itemtype?: ValueType;
    optional?: boolean;
    isId?: boolean;
    inheritFrom?: string | RuleInheritanceWithOptions;
}

// ######## Version Types ########

interface VersionNodeBase<T extends OneVersionedObjectTypes = OneVersionedObjectTypes> {
    depth: number;
    creationTime: number;
    data: SHA256Hash<T>;
}

export interface VersionNodeChange<T extends OneVersionedObjectTypes = OneVersionedObjectTypes> extends VersionNodeBase<T> {
    $type$: 'VersionNodeChange';
    prev: SHA256Hash<VersionNode<T>>;
}

export interface VersionNodeEdge<T extends OneVersionedObjectTypes = OneVersionedObjectTypes> extends VersionNodeBase<T> {
    $type$: 'VersionNodeEdge';
}

export interface VersionNodeMerge<T extends OneVersionedObjectTypes = OneVersionedObjectTypes> extends VersionNodeBase<T> {
    $type$: 'VersionNodeMerge';
    nodes: Set<SHA256Hash<VersionNode<T>>>;
}

export type VersionNode<T extends OneVersionedObjectTypes = OneVersionedObjectTypes> =
    | VersionNodeEdge<T>
    | VersionNodeChange<T>
    | VersionNodeMerge<T>;
export const versionNodeTypes = ['VersionNodeEdge', 'VersionNodeChange', 'VersionNodeMerge'];

// ######## CRDT Types ########

/**
 * Interface that lists all crdt capable versioned one objects.
 *
 * This interface is very similar to OneVersionedObjectInterfaces. The only difference is,
 * that this interface collects the one types that use CRDTs for synchronization. All types
 * that appear here are automatically inherited by OneVersionedObjectInterfaces.
 */
import type {
    OneIdObjectInterfaces,
    OneUnversionedObjectInterfaces,
    OneVersionedObjectInterfaces
} from '@OneObjectInterfaces';
import type {ErrorWithCode} from './errors.js';
import type {HexString} from './util/arraybuffer-to-and-from-hex-string.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';

/**
 * Declare the private ONE storage for RECIPES. They describe how objects are built and are used
 * to create the Javascript, JSON and the microdata representations of ONE objects.
 *
 * Note: The examples for each ONE object type recipe are **with newlines and indentation** for
 * readability. The actual output will not have spaces or newlines!
 * @static
 * @type {Recipe[]}
 */
export const CORE_RECIPES: readonly Recipe[] = [
    {
        $type$: 'Recipe',
        name: 'Access',
        rule: [
            {
                itemprop: 'object',
                itemtype: {
                    type: 'referenceToObj',
                    allowedTypes: new Set(['*'])
                },
                isId: true
            },
            {
                // Reference to ID hashes of persons
                itemprop: 'person',
                itemtype: {
                    // TODO Change ALL the wrong "bag" to "set", not just here
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['Person'])
                    }
                }
            },
            {
                // References to ID hashes of groups
                itemprop: 'group',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['Group'])
                    }
                }
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'IdAccess',
        rule: [
            {
                itemprop: 'id',
                itemtype: {
                    type: 'referenceToId',
                    allowedTypes: new Set(['*'])
                },
                isId: true
            },
            {
                itemprop: 'person',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['Person'])
                    }
                }
            },
            {
                itemprop: 'group',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['Group'])
                    }
                }
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'Chum',
        rule: [
            {
                // Every chum is identified by a name.
                // <span itemprop="name">some-name</span>
                itemprop: 'name',
                isId: true
            },
            {
                // Names of the two instances that can exchange data via this chum.
                // <span itemprop="instance">instance name</span>
                itemprop: 'instance',
                isId: true,
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'string'
                    }
                } // always 2
            },
            {
                // Person hash of the two persons who can exchange data via this Chum.
                // Also used to authenticate the remote user.
                // TODO Make it a referenceToIdObj
                // <span itemprop="person">personHash</span>
                itemprop: 'person',
                isId: true,
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'string',
                        regexp: /^(undefined|[0-9a-f]{64})$/
                    }
                } // Our type "SHA256Hash"
            },
            {
                // Milliseconds-since 1/1/1970 timestamp
                // <span itemprop="highestRemoteTimestamp">timestamp</span>
                itemprop: 'highestRemoteTimestamp',
                itemtype: {
                    type: 'integer'
                }
            },
            // The transfer lists cannot be saved as "array of two" (pairs) because they already
            // are arrays (list:'orderedByONE'), and saving them as JSON-encoded strings is not
            // possible since that would prevent the reverse-map updates for the reference links
            // as well as any other hash-link based functionality.
            {
                itemprop: 'AtoBObjects',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['*'])
                    }
                }
            },
            {
                itemprop: 'AtoBIdObjects',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['*'])
                    }
                }
            },
            {
                itemprop: 'AtoBBlob',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToBlob'
                    }
                }
            },
            {
                itemprop: 'AtoBClob',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToClob'
                    }
                }
            },
            {
                itemprop: 'BtoAObjects',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['*'])
                    }
                }
            },
            {
                itemprop: 'BtoAIdObjects',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['*'])
                    }
                }
            },
            {
                itemprop: 'BtoABlob',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToBlob'
                    }
                }
            },
            {
                itemprop: 'BtoAClob',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToClob'
                    }
                }
            },
            {
                itemprop: 'BtoAExists',
                itemtype: {
                    type: 'integer'
                }
            },
            {
                // For logging purposes: statistical data
                // <span itemprop="statistics">{sent:...,received:...}</span>
                itemprop: 'statistics',
                itemtype: {type: 'stringifiable'},
                optional: true
            },
            {
                // For logging purposes: List of errors raised by the importer or exporter
                // <span itemprop="errors">["..."]</span>
                itemprop: 'errors',
                itemtype: {type: 'stringifiable'},
                optional: true
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'Group',
        rule: [
            {
                // <span itemprop="name">${name}</a>
                itemprop: 'name',
                isId: true
            },
            {
                itemprop: 'person',
                itemtype: {
                    type: 'bag',
                    item: {
                        type: 'referenceToId',
                        allowedTypes: new Set(['Person'])
                    }
                }
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'Instance',
        rule: [
            {
                // Every instance is identified by name, which should be unique per user.
                itemprop: 'name',
                isId: true
            },
            {
                // The owner of the app represented by its person ID.
                itemprop: 'owner',
                itemtype: {
                    type: 'referenceToId',
                    allowedTypes: new Set(['Person'])
                },
                isId: true
            },
            {
                // Reference to Recipe objects.
                itemprop: 'recipe',
                itemtype: {
                    type: 'set',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set(['Recipe'])
                    }
                }
            },
            {
                itemprop: 'enabledReverseMapTypes',
                itemtype: {
                    type: 'map',
                    key: {
                        type: 'string'
                    },
                    value: {
                        type: 'set',
                        item: {
                            type: 'string'
                        }
                    }
                }
            },
            {
                itemprop: 'enabledReverseMapTypesForIdObjects',
                itemtype: {
                    type: 'map',
                    key: {
                        type: 'string'
                    },
                    value: {
                        type: 'set',
                        item: {
                            type: 'string'
                        }
                    }
                }
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'Keys',
        rule: [
            {
                itemprop: 'owner',
                itemtype: {
                    type: 'referenceToId',
                    allowedTypes: new Set(['Instance', 'Person'])
                }
            },
            {
                // ENCRYPTION KEY: Hex encoded public key (64 characters)
                itemprop: 'publicKey',
                // TweetNaCl length is n=32 bytes
                itemtype: {
                    type: 'string',
                    regexp: /^[A-Za-z0-9+/]{64}$/
                }
            },
            {
                // SIGN KEY: Hex encoded public key (64 characters)
                itemprop: 'publicSignKey',
                // TweetNaCl length is n=32 bytes
                itemtype: {
                    type: 'string',
                    regexp: /^[A-Za-z0-9+/]{64}$/
                }
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'Person',
        rule: [
            {
                itemprop: 'email',
                isId: true
            },
            {
                itemprop: 'name',
                optional: true
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'Recipe', // This recipe describes _itself_ :-)
        rule: [
            {
                // <span itemprop="name">${name}</span>
                itemprop: 'name',
                isId: true
            },
            {
                itemprop: 'crdtConfig',
                optional: true,
                itemtype: {
                    type: 'map',
                    key: {type: 'string'},
                    value: {type: 'string'}
                }
            },
            {
                itemprop: 'rule',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'object',
                        rules: [
                            {
                                // <span itemprop="itemprop">${itemprop}</span>
                                itemprop: 'itemprop'
                            },
                            {
                                itemprop: 'optional',
                                itemtype: {
                                    type: 'boolean'
                                },
                                optional: true
                            },
                            {
                                // <span itemprop="isId">${true}</span>
                                itemprop: 'isId',
                                itemtype: {
                                    type: 'boolean'
                                },
                                optional: true
                            },
                            {
                                itemprop: 'itemtype',
                                itemtype: {type: 'stringifiable'},
                                optional: true
                            },
                            {
                                itemprop: 'inheritFrom',
                                itemtype: {
                                    type: 'stringifiable'
                                },
                                optional: true
                            }
                        ]
                    }
                }
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'VersionNodeChange',
        rule: [
            {
                itemprop: 'prev',
                itemtype: {
                    type: 'referenceToObj',
                    allowedTypes: new Set([
                        'VersionNodeEdge',
                        'VersionNodeChange',
                        'VersionNodeMerge'
                    ])
                },
                optional: true
            },
            {
                itemprop: 'data',
                itemtype: {
                    type: 'referenceToObj',
                    allowedTypes: new Set(['*'])
                }
            },
            {
                itemprop: 'depth',
                itemtype: {
                    type: 'number'
                }
            },
            {
                itemprop: 'creationTime',
                itemtype: {
                    type: 'number'
                }
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'VersionNodeEdge',
        rule: [
            {
                itemprop: 'data',
                itemtype: {
                    type: 'referenceToObj',
                    allowedTypes: new Set(['*'])
                }
            },
            {
                itemprop: 'depth',
                itemtype: {
                    type: 'number'
                }
            },
            {
                itemprop: 'creationTime',
                itemtype: {
                    type: 'number'
                }
            }
        ]
    },

    {
        $type$: 'Recipe',
        name: 'VersionNodeMerge',
        rule: [
            {
                itemprop: 'nodes',
                itemtype: {
                    type: 'set',
                    item: {
                        type: 'referenceToObj',
                        allowedTypes: new Set([
                            'VersionNodeEdge',
                            'VersionNodeChange',
                            'VersionNodeMerge'
                        ])
                    }
                }
            },
            {
                itemprop: 'data',
                itemtype: {
                    type: 'referenceToObj',
                    allowedTypes: new Set(['*'])
                }
            },
            {
                itemprop: 'depth',
                itemtype: {
                    type: 'number'
                }
            },
            {
                itemprop: 'creationTime',
                itemtype: {
                    type: 'number'
                }
            }
        ]
    }
];
