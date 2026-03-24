/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2019
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * A module for centralized Error object creation. This allows reporting of errors to an error
 * tracking service as well as easy maintenance of error messages (e.g. for translations)
 * usually operated by the owner of the application.
 * @private
 * @module
 */

import {stringifyWithCircles} from './util/sorted-stringify.js';
import {isObject, isString} from './util/type-checks-basic.js';

export type ErrorWithCode = Error & {code?: string; cause?: Error & {name?: string; code?: string}};

/**
 * Checks if an error has a `code` property.
 * @static
 * @param {unknown} error
 * @returns {boolean}
 */
export function isErrorWithCode(error: unknown): error is ErrorWithCode {
    return typeof error === 'object' && error !== null && error instanceof Error && 'code' in error;
}

// This is just a suggestion
// const ERROR_CODE_REGEXP = /^[A-Z2]+(-[A-Z][A-Z0-9]*)+$/;

const ERRORS = {
    'DUMMY-ERROR':
        'This is a dummy error in stub functions in system code files only used during ' +
        'development. If this error shows up the application was not build correctly.',

    'ERROR-ERROR':
        'THE ERROR MESSAGE ITSELF HAS A PROBLEM:\n\n' +
        'The createError(...) 2nd parameter has an object property "name" that would\n' +
        'set the Error object\'s "name" property. However, it does not seem to be a\n' +
        'valid name for an Error (it should be a CamelCaseError string that ends' +
        'with "Error").\n\n' +
        'The 2nd createError parameter object: $additionalProps\n\n' +
        'Actual error message below:\n\n' +
        '$msg`;\n',

    'ACC-CP1': 'Invalid Set-Access request parameters: $accessRequest',

    'AM-GARH1': 'No Set of accessible hashes found for person $personId',

    'AMC-COLL1':
        'Unexpectedly found hash $hash in path $path, after $lineNr hashes collected, ' +
        'which we did not see previously, despite top-dopwn iteration.',

    // Chum exporter service
    'CES-GBL1': 'Unauthorized, BLOB $hash',
    'CES-GBL2': 'Bad request: Invalid "encoding" parameter: $encoding',
    'CES-GIDO1': 'Unauthorized, id-obj $hash',
    'CES-GIDO2': 'Requested file $hash is not a ONE microdata object',
    'CES-GIDOC1': 'Unauthorized, id-obj children for $hash',
    'CES-GMD1': 'Unauthorized, metadata $hash',
    'CES-GMD2': 'Requested file $hash is not a ONE microdata object',
    'CES-GMD3': 'Requested file $hash has not a crdt type, found $type',
    'CES-GO1': 'Unauthorized, obj $hash',
    'CES-GO2': 'Requested file $hash is not a ONE microdata object',
    'CES-GOC1': 'Unauthorized, obj children for $hash',

    // Chum importer
    'CI-PVO1': 'Root type assertion failed for id, expected $eType, found $fType',
    'CI-PVO2': 'Root type assertion failed for version, expected $eType, found $fType',
    'CI-PVH1': 'Reject received object - type mismatch, expected $eType, found $fType',
    'CI-PVH2': 'Reject received object - type mismatch, expected $eType, found $fType',
    'CI-PID1': 'Reject received object - type mismatch, expected $eType, found $fType',
    'CI-CCI1':
        'The root AccessibleVersionNode.dataIdHash $dataIdHash does not match the' +
        ' VersionNode.idHash $idHash',
    'CI-CCI2':
        'The root dataType AccessibleVersionNode.dataType $dataType does not match the type of' +
        ' VersionNode.dataIdHash $type',
    'CI-ACO': 'Reject received object - missing dependency $dep of obj $obj',
    'CI-ACIDO': 'Reject received id-object - missing dependency $dep of obj $obj',

    // Chum importer exporter client
    'CIEC-FBL1': 'Expected FileCreation object, got $blobResult',
    'CIEC-FBL2': 'Blob hash mismatch, expected: $hash, actual: $resultHash',
    'CIEC-FIDO1': 'Expected ONE object microdata string, got $type',
    'CIEC-FIDO2': 'Microdata hash mismatch, expected: $hash, actual: $calculatedHash',
    'CIEC-FIDO3': 'Reject received id-object of forbidden access-related type, obj: $obj',
    'CIEC-FIDO4': 'Expected array of ONE object microdata strings',
    'CIEC-FIDO5': 'Reject received object of forbidden access-related type, obj: $obj',
    'CIEC-FIDO6': 'Reject received object of non versionNode type, obj: $obj',
    'CIEC-FIDOWT1': 'Type assertion failed, expected $eType, found $fType',
    'CIEC-FMD1': 'Expected ONE object microdata string, got $type',
    'CIEC-FMD2': 'Received metadata is not metadata for requested object',
    'CIEC-FO1': 'Expected ONE object microdata string, got $type',
    'CIEC-FO2': 'Microdata hash mismatch, expected: $hash, actual: $calculatedHash',
    'CIEC-FO3': 'Reject received object of forbidden access-related type, obj: $obj',
    'CIEC-FOWT1': 'Type assertion failed, expected $eType, found $fType',

    'CR-RS1': 'Maximum length is 65,536, but we got $length',

    'CS-MISMATCH': '[$connId] Chum protocol mismatch, local: $local, remote: $remote',

    'CRDTR-G1': 'Tried to generate CrdtMetaRecipe for non CrdtObject recipe: $recipe',
    'CRDTR-G2': 'Object CRDT implementation not found.',
    'CRDTR-GM1': 'Optional lists for CRDTs are not supported: $rule',
    'CRDTR-GMR1': 'referenceToObj is undefined for rule: $rule',
    'CRDTR-GMR2': 'referenceToObj is undefined for rule: $rule',

    'CYAPI-PUBSK': 'Sign keypair was not specified',
    'CYAPI-SIGN': 'Sign keypair was not specified',

    'CYENC-ENSNCE': 'Data is not a nonce',
    'CYENC-ENSPUB': 'Data is not a public key',
    'CYENC-ENSSEC': 'Data is not a secret key',
    'CYENC-ENSSLT': 'Data is not a safe salt, it should be at least 16 bytes long',
    'CYENC-ENSSYM': 'Data is not a symmetric key',
    'CYENC-SYMDEC': 'Decryption with symmetric key failed',

    'CYSIG-ENSPUB': 'Data is not a public sign key',
    'CYSIG-ENSSEC': 'Data is not a secret sign key',

    // Determine accessible hashes
    'DAH-PAO1': 'Expected string, found $data',
    'DAH-PAO2': 'Expected array, found $data',
    'DAH-PAO3': 'Expected unversioned, versioned or id, found $type',

    // Determine children
    'DC-PC1': 'Expected string, found $data',
    'DC-PC2': 'Expected array, found $data',
    'DC-PC3': 'Expected blob, clob, id or object found $type',
    'DC-PC4': 'Expected hash found $hash',

    'EVS-CR1': 'Function is already subscribed',
    'EVS-CR2': 'Function is not subscribed',

    'FF-FF1': 'Only https and http are supported, not $protocol (URL: $urt)',
    'FF-FF2': 'Status code: $code, Message: $text',

    'IC-CPW1': '2nd parameter "oldSecret" must be a string or null',
    'IC-CPW2': '3rd parameter "newSecret" must be a string',
    'IC-CPW3': 'Instance could not be started (instance ID hash still is undefined)',

    'IN-DI1': 'Tried to delete a non existing instance with name $instanceName and email $email',
    'IN-INIT1': 'Instance "$iName" is already active',
    'IN-INIT2':
        'Instance "$iName" initialization aborted: "secret" is not a string but storage ' +
        'encryption is requested',
    'IN-CADCI1': 'Tried to call close and delete without an active instance',

    'KEYCH-NODEFKEYS': 'You do not have default keys for this person or instance with ID $owner',
    'KEYCH-HASDEFKEYS': 'You already have default keys for this person or instance',
    'KEYCH-CDK1':
        'Instance initialization aborted. When a pair of $keyType keys is provided, then ' +
        'both keys must be provided, but one is undefined:\n' +
        '  Type of the encryption key is $encType\n' +
        '  Type of the sign key is $sigTypen',

    'KEYMKM-HASKEY': 'Master key is already loaded',
    'KEYMKM-NOKEY': 'No masterkey available',
    'KEYMKM-NOKEYDEC': 'No masterkey available for decryption',
    'KEYMKM-NOKEYENC': 'No masterkey available for encryption',

    'M2J-PV1': 'Expected end tag $endStr not found at $nr',
    'M2J-PND1': 'Value for property "$itemprop" is missing but "optional" flag is not set',
    'M2J-PND2': 'Expected end-tag $endStr not found (position: $pos), Microdata: $html',
    'M2J-PD1': 'Value for property "$itemprop" is missing but "optional" flag is not set',
    'M2J-PO1': 'Found no start and/or end tag',
    'M2J-PO2': 'Expected end-tag $endStr not found (position: $newPosition), Microdata: $html',
    'M2J-CONV1': 'Mandatory string parameter (HTML) missing',
    'M2J-CONV2': 'Failed to parse $nr characters',

    'M2IH-FET1': 'Did not find end tag; Starting from position $position in $html',
    'M2IH-XID1': 'Did not find ID property "$itemprop" in $microdata',
    'M2IH-CALC1': 'Hash $hash already is an ID hash',

    'M2O-PV1': 'Property "$itemprop" is not a valid hash: "$valueStr"',
    'M2O-PV2': 'Expected end tag $endStr not found at $position',
    'M2O-PV3': 'Value "$value" does not match RegExp $regexp',
    'M2O-PND1': 'Value for property "$itemprop" is missing, but there is no "optional" flag',
    'M2O-PND2': 'Expected end-tag $endStr not found (position: $position); Microdata: $html',
    'M2O-EOTFM1':
        'Value for property "$itemprop" is missing but there is no "optional" flag;\n' +
        'Microdata: $html',
    'M2O-PD1':
        'Value for property "$itemprop" is missing but there is no "optional" flag;\n' +
        'Microdata: $html',
    'M2O-PHM1': 'Expected type $expectedType, got $type;\nMicrodata: $html',
    'M2O-PIH1': 'Parameter "itemprop" is undefined, html: $html',
    'M2O-PH1': 'This does not look like valid ONE microdata (isIdObj is $isIdObj): $html',
    'M2O-POM1': 'Expected end-tag $endStr not found (position: $position), Microdata: $html',
    'M2O-PCONV1': 'Mandatory string parameter (HTML) missing',
    'M2O-PCONV2': 'Failed to parse the last $nr characters in $html',

    'MB-ON1': 'This function is already registered for "$type" events',
    'MB-CRMB1': 'Required parameter "moduleId"" missing',
    'MB-CRMBID1': 'Required parameter "moduleId"" missing',

    'MEX-PV2': 'Expected end tag $endStr not found at $pos',
    'MEX-PV3': 'Value "$value" does not match RegExp $regexp',
    'MEX-PND1': 'Value for property "$itemprop" is missing but "optional" flag is not set',
    'MEX-PND2': 'Expected end-tag $endStr not found (position: $newPosition), Microdata: $html',
    'MEX-PD1': 'Value for property "$itemprop" is missing but "optional" flag is not set',
    'MEX-PHD1': 'Expected type $expected, got $type;\nMicrodata: $html',
    'MEX-PHA1': 'Expected data-hash attribute at $position not found;\nMicrodata: $html',
    'MEX-PIH1': 'Parameter "itemprop" is undefined',
    'MEX-PIH2': 'Expected string "$expected" at $idHashEnd not found;\nMicrodata: $html',
    'MEX-PH1': 'This does not look like valid ONE microdata: $html',
    'MEX-PIO1': 'Expected end-tag $endStr not found (position: $dataEnd), Microdata: $html',
    'MEX-PIO2': 'Hash mismatch, expected hash/idHash $hash/$idHash, got $rHash/$rIdHash',
    'MEX-PIO3': 'Expected a versioned object, got $type',
    'MEX-PIO4': 'Expected HTML span end-tag for imploded pbject at position $position in $html',
    'MEX-PO1': 'Expected end-tag $endStr not found (position: $dataEnd), Microdata: $html',
    'MEX-PO2': 'Failed to parse $nr characters',
    'MEX-PEXPL1': 'Mandatory string parameter (HTML) missing',

    'MIMP-FRH1':
        'Failed matching the data-type attribute of the "a" HTML tag for a hash link;\n' +
        'itemprop: $itemprop, position: $position, microdata: $microdata"',
    'MIMP-FRH5':
        'Failed to parse a hash in the "a" HTML tag for a hash link;\n' +
        'itemprop: $itemprop", position: $position, microdata: $microdata',
    'MIMP-GF10':
        'Impossible - This is not supposied to ever happen. Something is very wrong' +
        ' with the (micro)data the microdata-imploder or both. itemprop: $itemprop, reference:' +
        ' $reference',
    'MIMP-MAPF1': 'No rule for "$itemprop" found in recipe $recipe',
    'MIMP-IMPL1': 'The given parameter does not contain a ONE object',

    'OGI-ERR':
        'Object-Graph-Iterator: StopIteratorError stops the iteraton and by itself is not ' +
        'a "real" error',
    'OGI-WALK1': '"hash" must not be undefined',
    'OGI-WALK2': 'Value for idLinkIteration option must be one of $all but it is $val',

    'O2M-INCLOB':
        'Expected "$refType", got "$type": $objects\n' +
        'If this is an IMPLODED OBJECT explode it first',
    'O2M-RTYC1': 'Value for itemprop "$itemprop" should be of type "$type", Value: $val',
    'O2M-RTYC2': 'Mandatory property "$itemprop" missing; Rule: $rule',
    'O2M-RTYC3': 'Property "$itemprop" value "$val" does not match RegExp $regexp',
    'O2M-RTYC4':
        'Value for hash-link itemprop "$itemprop" should be SHA-256 hash (lower case hex 64 ' +
        'characters), Value: $val',
    'O2M-CBAS2': 'Unexpected object as value for itemprop "$itemprop": ", Value: $val',
    'O2M-CBAS3': 'Property "$itemprop" is not a valid hash: "$val"',
    'O2M-CVAL3': 'Property "$itemprop" should not be array; Rule: $rule',
    'O2M-CVAL4': 'Property "$itemprop" should be an array; Rule: $rule;\nValue: $val',
    'O2M-CVAL5':
        'Property "$itemprop" should be an array but it is not.\n' +
        'Rule: $rule\n' +
        'Value: $val',
    'O2M-CNO1':
        'Property "$itemprop" should be a nested object or an array of nested objects.\n' +
        'Item #$idx is not an object but is $type.\n' +
        'Value: $obj',
    'O2M-COBJ1': 'Cannot make ID object from unversioned obj. $obj',
    'O2M-COBJ2': 'Unknown properties $objProperties in $obj',
    'O2M-CONV': 'Parameter must be an object, value: $obj',

    'OR-ET1': 'Type "$type" not found in recipes',
    'OR-GR1': 'Type "$type" not found in recipes',
    'OR-ADDR1': 'A recipe for type "$rName" already exists',
    'OR-ISVO1': 'Type "$type" not found in recipes',
    'OR-EVO1': 'Type "$type" is not a versioned object type',
    'OR-GR01': 'Could not find a rule in recipe "$recipeName" using path $path',
    'OR-GR02':
        'With recipe $recipeName, path still is $path, but the rule we arrived at is not a' +
        ' nested rule to apply the path to',
    'OR-RSRI1': "The rule itemtype must be one of those: ['bag', 'array', 'set']",
    'OR-RSRI2': 'The rule itemtype must be map',

    'PJ-PJ1': 'Only https and http are supported, not $protocol (URL: $urt)',
    'PJ-PJ2': 'Status code: $code, Message: $text',
    'PJ-PJ3': 'Error fetching from $url',
    'PJ-PJ4': 'Error posting to $url',

    'PL-SPL1': 'Detected platform "$SYSTEM" does not match the loaded platform "$pl"',
    'PL-CPL1':
        'Platform modules have not been loaded yet. There must be a static or a dynamic ' +
        'import of "@refinio/one.core/lib/system/load-(browser|nodejs).js" before calling ' +
        'any one.core function that uses platform-specific code, such as any storage, ' +
        'crypto, SettingsStore, or websocket functions.',

    'RMQ-AE1':
        'The given mapName "$mapName" is invalid:\n' +
        'Expecting {SHA-256-Hex}.Object.{ONE-Object-Type-Name}\n' +
        'Looks like hash: $isHash,\n' +
        'Has ".Object." between hash and type at position 64: $hasObject,\n' +
        'Valid ONE object type "$type", hasRecipe: $isValidType',
    'RMQ-AE2':
        'The given mapName "$mapName" is invalid:\n' +
        'Expecting {SHA-256-Hex}.IdObject.{ONE-Object-Type-Name}\n' +
        'Looks like hash: $isHash,\n' +
        'Has ".IdObject." between hash and type at position 64: $hasIdObject,\n' +
        'Valid ONE object type "$type", hasRecipe: $isValidType',

    'RMU-CE1': 'Param targetHash does not look like a hash: $targetHash',
    'RMU-CE2': 'Param typeOfReferencingObj is not a known ONE object type: $typeOfReferencingObj',
    'RMU-CE3': 'Param hashOfReferencingObj does not look like a hash: $hashOfReferencingObj',

    'SB-ONIDXDB1': 'This element is only available on the browser platform',
    'SB-SETDIR': 'Base directory already set to $oldDir, new attempted value: $newDir',
    'SB-NO-INIT1': 'Storage not initialized',
    'SB-NO-INIT2': 'Storage not initialized',
    'SB-NORM-FN1': 'Storage not initialized',
    'SB-CRLVL1': 'Too many subdirectory levels, maximum number supported is $max, but got $val',
    'SB-INIT2': 'IndexedDB with name "$dbName" is already open, close it first',
    'SB-INIT3': 'Instance with ID hash $hash does not exist',
    'SB-INIT4':
        'Parameter nHashCharsForSubDirs is $nHashCharsForSubDirs - but only 0 (or undefined) is ' +
        'supported on this platform',
    'SB-INIT5': 'Storage encryption is unsupported on this platform',
    'SB-INIT6': '"secret" is null but must always be a string on tis platform',
    'SB-INIIT11':
        'Upgrade of database "$dbName" on indexedDB.open() blocked by open connections ' +
        'somewhere else (e.g. another tab)',
    'SB-INIIT12': 'Error opening database "$dbNme"',
    'SB-INIIT13': 'Opening of database "$dbName" aborted',
    'SB-INIIT14': 'Opening of database "$dbName" aborted: Unexpected close event',
    'SB-DELST1': 'ID hash parameter is not a hash: $instanceIdHash',
    'SB-READ': 'Error while trying to read file $filename [$type]: $err',
    'SB-READ1': 'No filename given',
    'SB-READ2': 'File not found: $filename [$type]',
    'SB-RASEC1':
        'Mandatory parameter missing or of the wrong type, ' +
        'filename: $filename, ' +
        'type: $type, ' +
        'offset: $offset, ' +
        'length: $length',
    'SB-RASEC2':
        'File not found: ' +
        'filename: $filename, ' +
        'type: $type, ' +
        'offset: $offset, ' +
        'length: $length',
    'SB-RASEC3':
        // This is a FileNotFound error
        'Length is greater than the negative offset, ' +
        'filename: $filename, ' +
        'type: $type, ' +
        'offset: $offset, ' +
        'length: $length',
    'SB-RASEC4':
        'Negative offset exceeds file size' +
        'filename: $filename, ' +
        'type: $type, ' +
        'offset: $offset, ' +
        'length: $length, ' +
        'file size: $size',
    'SB-RASEC5':
        'Offset + length exceed file size' +
        'filename: $filename, ' +
        'type: $type, ' +
        'offset: $offset, ' +
        'length: $length, ' +
        'file size: $size',
    'SB-RD-NOSTR': 'Requested file is not a string, filename: $filename',
    'SB-WRITE1': 'No contents given',
    'SB-WRITE2': 'No filename given',
    'SB-WRITEM1': 'No contents given',
    'SB-WRITEM2': 'No filename given',
    'SB-WRITEM3':
        'This function only supports writing files for version-node and for reverse-map (not for "$type")',
    'SB-APPEND1': 'No contents given',
    'SB-APPEND2': 'No filename given',
    'SB-APPEND3':
        'Appending to files only supported for version-map and for reverse-map (found "$type")',
    'SB-GETN1': 'No filename given',
    'SB-GETN2': 'File not found: $filename [objects]',
    'SB-EXISTS': 'No filename given',
    'SB-STORE': 'String undefined or it has zero length',
    'SB-STUV': 'Not implemented',
    'SB-RPBR1': 'Parameter "filename" is not a string: $filename',
    'SB-RPBR2': 'Error reading private file "$filename": $err',
    'SB-RPBR3': 'File $filename not found in storage space "private"',
    'SB-RPBR4': 'File $filename is not an ArrayBuffer (Browser/IndexedDB-storage-only error)',
    'SB-WPBR1': 'Contents argument (2nd) must be ArrayBuffer, but is $type. File: "$filename"',
    'SB-WPBR2': 'Filename argument (1st) is not a string, value: "$filename"',
    'SB-WPBR3': 'File "$filename" in private storage space already exists',
    'SB-WPBR4': 'Error writing file "$filename" in private storage space: $err',

    'SC-EK1': 'filenameEncryptionKey is null',
    'SC-EK2': 'filenameNonce is null',
    'SC-DK1': 'filenameEncryptionKey is null',
    'SC-DK2': 'filenameNonce is null',
    'SC-DK3': 'decryption of key failed (result is null)',
    'SC-ENC1': 'Cannot encrypt: storageEncryptionKey is null (not yet initialized?)',
    'SC-DEC1': 'Cannot decrypt: storageEncryptionKey is null (not yet initialized?)',
    'SC-DEC2': '"contents" is not an ArrayBuffer, is typeof $type',
    'SC-DEC3': 'Decryption of the inner box failed (result is null)',
    'SC-DEC4': 'Expected text flag to be either string: $S or binary: $B, but found $textFlag',
    'SC-INIT1': 'File not found: $filename',
    'SC-READ1': 'Reading private file $filename failed, Error: $err',
    'SC-READ2': 'Reading private file $filename failed, Error: $err',
    'SC-READ3': 'File not found: $filename [private]',
    'SC-LDENC': 'Decryption of private file $filename failed',

    'SBD-DEL1': 'No filename given [$type]',

    'SRH-AEMAP1':
        'Trying to add type "$type" twice to the list of types for which reverse maps' +
        ' should be created; with values (properties) of: $props',

    'SST-PARA1':
        'Refuse create write-stream: 2nd parameter filename (value: $filöenam) can only be used ' +
        'with a storage type that is not "objects".',
    'SST-MV1': 'File name is missing (old, new, or both); old: $oldName, new: $newName',
    'SST-MV2': 'File not found: $filename [tmp]',
    'SST-MV3': 'File not found: $filename [tmp]',
    'SST-MV7':
        'The target of the move already exists and is not a regular file while trying to' +
        ' move $old to $new',
    'SST-CR1': 'No filename given',
    'SST-CR2': 'Only one event listener allowed',
    'SST-CR3': 'File not found: $filename [objects]',
    'SST-CR6': 'Cancel stream',
    'SST-CW2':
        'Received string chunk with encoding=undefined: Use "utf8" encoding for UTF-8 streams' +
        ' and "base64" for binary streams if chunks are strings',
    'SST-CW3':
        'Writing to binary file with encoding="$encoding": Use _no_ encoding (undefined) if' +
        ' chunks are ArrayBuffers',
    'SST-CAN': 'Write stream was canceled',
    'SST-EMIT1': 'Requesting UTF-8 file $hash with encoding="$encoding": Use "utf8" instead',
    'SST-EMIT2':
        'Requesting binary file $hash with encoding="utf8": Use "base64" or no encoding instead',
    'SST-ENDED': 'Stream already ended',
    'SST-END1': 'No data was received, no file was created',
    'SST-WTYPE': 'First chunk was $typeofFirstChunk but new chunk is $typeofData',

    'SUO-SO1':
        'Object type is versioned. This function only stores unversioned objects.' +
        ' Versioned objects require updating their version map. Object: $obj',

    'SVO-MVHWC1': 'The given version node $nodeHash points to another version node',
    'SVO-SO2': 'The given object is not a versioned object type. Object $obj',
    'SVO-GET1': 'Object $hash of type $type is not a versioned object',

    'VMQ-GNTH1': 'Index $newIndex is too $sOrL, nr. of entries $total',

    'WSP-EWSNN': 'Websocket (ws) is undefined or null',
    'WSP-ESV': 'Key "$key" value $value ("$typeofValue") is not allowed',
    'WSP-CRWS1':
        'Mandatory parameter "WriteStorage" is missing or does not have a function ' +
        '"createFileWriteStream"; value: $WriteStorage',
    'WSP-SN1': 'Websocket has not been created yet (undefined)',
    'WSP-SN3': '"type" must be a number > 0 but is $serviceId ($typeOfType)',
    'WSP-SN4': 'Error on sending message over an encrypted connection',
    'WSP-CL': 'Websocket has not been created yet (undefined)',
    'WSP-ONCL0': 'Aborted: Connection closed',
    'WSP-ONCL1': 'Connection closed with $nr requests still pending ($serviceIds)',
    'WSP-ERR': 'Unspecified error',

    'WSRQ-CRSTH1': 'Read stream already exists for #$id',
    'WSRQ-CWRST1': 'Write stream already exists for request #$responseId',
    'WSRQ-JRMH1': 'Remote websocket function returned an error (see "cause" property)',
    'WSRQ-SEH1':
        'Remote ReadStream failed. While receiving a stream we received an error from ' +
        'the sender. Message: $msg',

    'UFU-THROTT1': 'UNHANDLED EXCEPTION: No onError callback',

    'ULRU-CRM1': 'maxSize parameter $maxSize ($type) is too small or not a number',

    'UO-TFM1': 'No type detected in $microdata',
    'UO-TRACKP1': 'Access to "$key" denied: Reference to a mutable object',
    'UO-TRACKP2': 'Write access to "$key" denied',

    'UP-RETR1': 'Parameter must be a function but is $type',
    'UP-SER1': 'Expected functions as parameters',
    'UP-SERWT1': 'Expected functions as parameters',

    'UQ-DEQ': 'Queue is empty',
    'UQ-DEQN': 'Queue does not have enough elements',

    'USS-STR1': 'Object cannot be stringified because it has a circle; property: $property',
    'USS-STR4': 'Promise, Function or Symbol are not allowed: $obj',

    'UPR-TO1':
        'A timeout delay of 0 is hard to predict and therefore not allowed. Does it mean ' +
        'the timeout should occur right away without waiting for the promise?',
    'UPR-TO': 'Timeout: $txt',

    'US-SSFMC1':
        'Start and length must be non-negative integers; start: $start, length: ' +
        '$length, string: $s',

    'USC-CAOH1': 'Function checkAllObjectHashes is already running (once is enough)',

    'UTC-EHASH': 'Value "$thing" is not a SHA-256 hash',
    'UTC-EIDHASH': 'Value "$thing" is not a SHA-256 hash (ID)',
    'UTC-AHASH': 'Expected Array of SHA256Hash, got $thing',

    'URC-EREF': 'Value "$thing" is not a ONE Reference object',
    'URC-RRP1': 'No "Recipe" recipe',
    'URC-RRP2': 'Cannot find the nested RecipeRule objects array in Recipe recipe',
    'URC-RRP3': "Cannot find the 'itemtype' field in Recipe recipe",
    'URC-RRP4': "'Rule' field must be a bag type which has an object type as items",
    'URC-ERECI1': 'Not an object but "$type"',
    'URC-ERECI2': 'Rule #$index "isId" is set but not allowed in a nested rule',
    'URC-ERECI3': 'Rule #$index has an unknown property $prop',
    'URC-ERECI4': 'Rule #$index: "$prop" is missing but is not marked as optional',
    'URC-ERECI5': 'Rule #$index: "$prop" must be $valueType but is $propType',
    'URC-ERECI6': 'Rule #$index: "$prop" must be a Map but is $oName',
    'URC-ERECI7': 'Rule #$index: "$prop" must be a Set but is $oName',
    'URC-ERECI8': 'Rule #$index: mandatory "itemprop" must not contain <, >, ., or whitespace',
    'URC-ERECI9': '"list" must be one of undefined, $optVals but is $thingList',
    'URC-ERECI12':
        'Only one of "referenceToObj", "referenceToId", "referenceToBlob" or "referenceToClob" ' +
        'can be used in one rule. Rule: $rule',
    'URC-ERECI14':
        'Rule #$index: "referenceToObj" must be a Set of ONE object type strings or "*",\n' +
        'but it is currently set to $ref ($oName)',
    'URC-ERECI15':
        'Rule #$index: "referenceToId" must be a Set of ONE object type strings or "*",\n' +
        'but it is currently set to $ref ($refName)',
    'URC-ERECI16':
        'Rule #$index: "referenceToBlob" must be boolean, but it is currently set to $ref ($refName)',
    'URC-ERECI17':
        'Rule #$index: "referenceToClob" must be boolean, but it is currently set to $ref ($refName)',
    'URC-ERECI18':
        'Rule #$index: Only one of "referenceToObj", "referenceToBlob", "referenceToClob", ' +
        '"referenceToId" can be used',
    'URC-ERECI19':
        'Rule #$index: optional "valueType" must be one of $jsTypeStrings but is $valueType',
    'URC-ERECI20':
        'Rule #$index: when "valueType" is "object" (i.e. JSON) also setting "list" is useless: ' +
        'You get the entire array stored anyway, just as a single value (JSON); Rule: $thing',
    'URC-ERECI21':
        'Rule #$index: "regexp" can only be used on properties with string values; Rule: $thing',
    'URC-ERECI22': 'Rule #$index: "regexp" is not a RegExp object $thing',
    'URC-ERECI23':
        'Rule #$index: optional "rules" must be non-empty array of RecipeRule objects; ' +
        'Property "rules": $rule',
    'URC-ERECI24': 'Rule #$index: "rules" cannot be combined with "isId"; All keys: [$thingKeys]',
    'URC-ERECI25':
        'Rule #$index, itemprop "$itemprop": Property "rule" exists but its value is "undefined"' +
        ' - While this could be intentional it could also be a signe of a mistake, for example' +
        ' when an array of rules is imported from another module but because of a circular' +
        ' reference issue ends up being undefined.',
    'URC-ERECI26':
        'Rule #$index, itemprop "$itemprop": This nested object rule creates a circle and ' +
        'infinite recursion. ONE object recipes must be tree structured without circles.',
    'URC-ERECI27':
        'Rule #$index: "inheritFrom" is a string, therefore it must be a path of type ' +
        'Recipe.itemprop[.itemprop] but it does not look like one; value: "$inheritFrom"',
    'URC-ERECI28':
        'Rule #$index: "inheritFrom" is an object, therefore it must be of type ' +
        'RuleInheritanceWithOptions; value: "$inheritFrom"',
    'URC-ERECI29': 'Rule #$index: "The value of "$type" must match the field "$field"',
    'URC-ERECI30-A':
        'Rule #$index: "max" option must be higher than "min" in numeric value type in $thing',
    'URC-ERECI30-B': 'Rule #$index: "max" and "min" options have to be integers in $thing',
    'URC-ERECI30-C':
        'Rule #$index: "max" option must be higher than "min" in numeric value type in $thing',
    'URC-ERECI30-D': 'Rule #$index: "max" and "min" options have to be numbers in $thing',
    'URC-ERECI31':
        'Rule #$index: "Key" option and "Value" option are missing in the map definion of "$map"',
    'URC-ERECI32': 'Rule #$index: "Item" option is missing in the definion of "$list"',
    'URC-ERECI33': 'Rule #$index: $type has no other option than "Type"',
    'URC-ERECI34': 'Rule #$index: "Key" of Map Object cannot be "$type"',
    'URC-CIT1': '"$itemprop" found more than once in rules',
    'URC-ERCP1': 'Not an object but "$type"',
    'URC-ERCP2': 'Not a "Recipe" object but "$type"',
    'URC-ERCP3':
        'Type "$recipeName" must not be empty, must not contain <, >, ., or whitespace, and ' +
        'JSON.stringify(recipeName) must equal the recipe-name surrounded by quotes',
    'URC-ERCP4': 'Recipe for "$recipeName" must be array of RecipeRule',

    'SET-READ': 'Could not read SettingsStore file due to "$err"',
    'SET-GET': 'Could not get SettingsStore Entry due to "$reason"',
    'SET-LOCK1': 'Could not write SettingsStore key $key - Lock is active',
    'SET-SET': 'Could not write SettingsStore Entry due to "$reason"',
    'SET-LOCK2': 'Could not remove SettingsStore key $key - Lock is active',
    'SET-RMV': 'Could not remove SettingsStore Entry due to "$reason"',
    'SET-CLR': 'Could not remove/clear SettingsStore: $err'
} as const;

const NO_TXT = '(No text found)';

/**
 * Creates the final error message from the error message template string and the parameters of
 * `createError`.
 *
 * The function takes the error message text string and looks for variables - i.e. words
 * starting with $. Those words are replaced with values on properties with the name of the word
 * after the $ character, if an "additionalProperties" parameter was given, and if such a
 * property exists (it should!).
 *
 * If a property cannot be found for a given variable in the template string the variable itself
 * is used, meaning no replacement takes place and the omission of the expected data is silently
 * ignored.
 * @private
 * @param {string} msg
 * @param {Readonly<Record<string, any>>} additionalProps
 * @returns {string}
 */
function txtReplace(msg: string, additionalProps: Readonly<Record<string, any>>): string {
    return msg.replace(/\$([A-Za-z_0-9]+)/g, (_$item, item) =>
        isObject(additionalProps[item])
            ? stringifyWithCircles(additionalProps[item])
            : additionalProps[item] === undefined
              ? 'undefined'
              : additionalProps[item]
    );
}

/**
 * All properties of the given error object are copied to the new Error object. There is special
 * treatment for a `stack` property, which is inserted in front of the new stack trace (string)
 * separated by a newline, and if there is a property `message` it is _appended_ at the end of
 * the `message` property of the new Error object, separated by a newline as well.
 *
 * The optional 2nd parameter object can be used to set the `name` property of the Error object.
 * We use this for "FileNotFoundError" errors. Since we do not subclass Error but use the `name`
 * property as an "instanceof" check this is a convenient method for setting the name.
 *
 * We only create `Error` objects. Different "class" types of errors can be differentiated by
 * the `name` property alone.
 * @static
 * @param {string} code - A code used to look up a message string template, or a default message
 * if the code is an empty string. If no entry is found in the map of error messages for this
 * string as key the string itself is used as error message. This way `createError("error
 * message")` can be used just like one would use `new Error("error message")`, which still
 * allows the benefit of the centralized error collection and reporting.
 * @param {(object|null)} [additionalProps] - An object whose _own(!)_ properties are copied onto
 * the new Error object. If the template string contains variables (names that start with a "$")
 * this object's properties are used to replace them. The property must be the exact same name
 * as the variable (minus the variable's leading "$"). If the property points to an object it is
 * stringified before it is placed in the message string.
 * @returns {Error}
 */
export function createError(
    code: string,
    additionalProps?: Readonly<Record<string, any>> | null
): ErrorWithCode {
    const err = new Error() as ErrorWithCode;
    const txt = code in ERRORS ? ERRORS[code as keyof typeof ERRORS] : NO_TXT;

    err.code = code;

    if (isObject(additionalProps)) {
        if (isString(additionalProps.stack)) {
            Object.assign(err, additionalProps, {
                stack: `Original stack: ${additionalProps.stack}\nNew stack: ${err.stack}`
            });
        } else {
            Object.assign(err, additionalProps);
        }

        if (txt === NO_TXT && isString(additionalProps.message)) {
            err.message = `${code}: ${additionalProps.message}`;
        } else {
            err.message = `${code}: ${txtReplace(txt, additionalProps)}`;

            if (isString(additionalProps.message)) {
                err.message += '\nOriginal message: ' + additionalProps.message;
            }
        }

        // The "name" property of Error objects should follow basic rules. This check is just
        // some basic insurance against accidental (mis-)use of this property, to catch when
        // somebody didn't mean to set an error's name.
        if (
            additionalProps.name !== undefined &&
            (!isString(additionalProps.name) || !additionalProps.name.endsWith('Error'))
        ) {
            err.message = txtReplace(ERRORS['ERROR-ERROR'], {additionalProps, msg: err.message});
        }
    } else {
        err.message = `${code}: ${txt}`;
    }

    return err;
}
