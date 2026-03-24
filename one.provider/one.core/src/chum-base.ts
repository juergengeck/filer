/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @author Maximilian Wisgickl <wisgicklma@gmail.com>
 * @copyright REFINIO GmbH & Maximilian Wisgickl 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @private
 * @module
 */

/**
 * Current version of the chum protocol.
 *
 * This version is compared at the beginning of the importer against the value provided by the
 * exporter. On mismatch the importer will terminate.
 *
 * @type {number}
 */
export const PROTOCOL_VERSION = 8;

/**
 * @static
 * @type {object}
 * @property {1} GET_PROTOCOL_VERSION - Chum protocol version to check if both sides are compatible
 * @property {2} GET_ACCESSIBLE_ROOTS - Get a list of accessible root hashes from the exporter
 * @property {3} NEW_ACCESSIBLE_ROOT_EVENT - Exporter notifies importer that a new accesible
 *                                           root hash was added
 * @property {4} GET_OBJECT_CHILDREN - Get a list of children for a specified hash from the exporter
 * @property {5} GET_ID_OBJECT_CHILDREN - Get a list of children for a specified id-hash from
 *                                        the exporter
 * @property {6} GET_OBJECT - Get ONE microdata (UTF-8 string) object from the exporter
 * @property {7} GET_ID_OBJECT - Get ONE microdata (UTF-8 string) id-object from the exporter
 * @property {8} GET_BLOB - Get ONE BLOB (bniary data) from the exporter
 * @property {9} GET_CRDT_META_OBJECT - Get ONE microdata (UTF-8 string) metaobject of
 *                                      specified object from the exporter
 * @property {10} FIN - Signal the exporter, that the importer is done. The exporter will terminate
 */
export const MESSAGE_TYPES = {
    GET_PROTOCOL_VERSION: 1,
    GET_ACCESSIBLE_ROOTS: 2,
    NEW_ACCESSIBLE_ROOT_EVENT: 3,
    GET_OBJECT_CHILDREN: 4,
    GET_ID_OBJECT_CHILDREN: 5,
    GET_OBJECT: 6,

    // Get ONE microdata (UTF-8 string) object with hash, path (path needed for the server to check
    // if the access is legit)
    // EXPORTER handles this event
    GET_ID_OBJECT: 7,

    // Get BLOB with hash, path (path needed for the server to check if the access is legit)
    // EXPORTER handles this event
    GET_BLOB: 8,

    // Get ONE microdata (UTF-8 string) for metadata object of a crdt object.
    // EXPORTER handles this event
    GET_CRDT_META_OBJECT: 9,

    FIN: 10
} as const;
