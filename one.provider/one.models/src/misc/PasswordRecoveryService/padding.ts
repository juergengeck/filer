import tweetnacl from 'tweetnacl';

/**
 * Strips the leading zeros from the passed array.
 *
 * @param arr - The array from which to remove the leading zeros.
 * @param minimumLength - Remove only that many leading zero bytes, so that the returned string
 * is still as large as this length.
 */
function stripLeadingZeros(arr: Uint8Array, minimumLength: number = 0): Uint8Array {
    let nonZeroBytFound = false;
    return arr.filter((value, index) => {
        if (index >= arr.length - minimumLength) {
            return true;
        }
        if (nonZeroBytFound) {
            return true;
        }

        if (value > 0) {
            nonZeroBytFound = true;
            return true;
        }

        return false;
    });
}

/**
 * Convert number to an Uint8Array with the least number of bytes where the number fits in.
 *
 * The result will be big endian (the byte at index 0 is the most significant byte)
 *
 * @param n - The number to convert to an Uint8Array.
 * @param minimumLength - If the returned value would have less bytes than this number, then add
 * leading zero bytes, so that it has this minimum length. If set to zero, then for n === 0 the
 * returned Uint8Array will have no elements.
 */
function convertNumberToUint8Array(n: number, minimumLength: number = 1): Uint8Array {
    if (minimumLength > 8) {
        throw new Error('The minimumL');
    }

    const arr = new Uint8Array(8);
    const view = new DataView(arr.buffer, arr.byteOffset);
    view.setBigUint64(0, BigInt(n));
    return stripLeadingZeros(arr, minimumLength);
}

/**
 * Calculate the number of bytes needed to achieve a padding of the specified amount of bytes.
 *
 * The question this function answers is:
 * If the goal is to have X padding bytes. How many bytes do I need to store the padding length
 * and how many remaining bytes do I need to fill the padding up to the specified total length.
 * Note that the padding length might need multiple bytes to be stored.
 *
 * Examples:
 * - first column is input
 * - second and third column is output.
 * - fourth column specifies the resulting padding (calculated by another functino) where r
 * denotes a random byte.
 *
 * | totalPaddingLength | lengthByteCount | randomByteCount |    | resulting padding           |
 * |--------------------|-----------------|-----------------|    |-----------------------------|
 * |                  0 |               0 |               0 |    |                             |
 * |                  1 |               1 |               0 |    | 0x00                        |
 * |                  2 |               1 |               1 |    | 0x01 r                      |
 * |                  3 |               1 |               2 |    | 0x02 rr                     |
 * |                ... |             ... |             ... |    |                         ... |
 * |                255 |               1 |             254 |    | 0xFE r(254 times)           |
 * |                256 |               2 |             255 |    | 0xFF r(255 times)           |
 * |                257 |               2 |             255 |    | 0x00 0xFF r(255 times)      |
 * |                258 |               2 |             256 |    | 0x01 0x00 r(256 times)      |
 * |                259 |               2 |             257 |    | 0x01 0x01 r(257 times)      |
 * |                ... |             ... |             ... |    |                         ... |
 * |              65536 |               2 |           65534 |    | 0xFF 0xFE r(257 times)      |
 * |              65537 |               2 |           65535 |    | 0xFF 0xFF r(257 times)      |
 * |              65538 |               3 |           65535 |    | 0x00 0xFF 0xFF r(257 times) |
 * |              65539 |               3 |           65536 |    | 0x01 0x00 0x00 r(257 times) |
 * |              65540 |               3 |           65537 |    | 0x01 0x00 0x00 r(257 times) |
 * |                ... |             ... |             ... |    |                         ... |
 *
 * @param totalPaddingLength
 */
function calculatePaddingCount(totalPaddingLength: number): {
    lengthByteCount: number;
    randomByteCount: number;
} {
    if (totalPaddingLength <= 0) {
        return {lengthByteCount: 0, randomByteCount: 0};
    }

    // This log2 is used to delay the addition of a random byte everytime we need another length
    // byte. You can see this in the example betweern 256 and 257 and 65537 and 65538.
    // "totalPaddingLength - log2" will yield the same result 255 for totalPaddingLength 256 and 257
    const log2 = Math.floor(Math.log2(totalPaddingLength) / 8);

    // This calculates the number of bytes the random padding length needs
    const lengthByteCount = Math.floor(Math.log2(totalPaddingLength - log2) / 8) + 1;

    // The number of required random bytes is just the total number of bytes minus the number of
    // bytes needed to store the length of the random bytes
    const randomByteCount = totalPaddingLength - lengthByteCount;

    return {
        lengthByteCount,
        randomByteCount
    };
}

/**
 * Add zero bytes at the start of the array so that the array has at least minimumLength bytes.
 *
 * If arr is larger than minimumLength the original array will be returned.
 *
 * @param arr - The array to zero extend.
 * @param minimumLength - The minimum length the array has after the call.
 */
function addZeroPaddingAtBeginning(arr: Uint8Array, minimumLength: number): Uint8Array {
    if (arr.length >= minimumLength) {
        return arr;
    }

    const ret = new Uint8Array(minimumLength);
    ret.set(arr, ret.length - arr.length);
    return ret;
}

/**
 * Add random padding bytes to the passed value.
 *
 * This function can handle any number of value lengths and padding lengths as long as total
 * output length is one byte larger than the original value (totalLength > value.length).
 *
 * Length information will also be stored within the padding bytes, so that the original value
 * can be unpacked without needing additional information. You can simply unpack the original
 * value with removePadding. Note that if value.length is very close to totalLength the added
 * padding bytes are not random, because they are just the length information. (A padding of one
 * byte will simply contain the information that 0 random padding bytes were added)
 *
 * Internals: This function does not store the value length, but the number of the added random
 * bytes. This has the advantage, that you can always pad a value with a length of value.length
 * to value.length + 1. When using the size of the value you would need more than one byte of
 * additional information if the length of the value is larger than 256.
 *
 * The internal layout of the padding is this:
 *
 * | Field 1: extra flags(high 4 bits) length of field2 (lower four bits) | Field 2: length of
 * field 3 | Field 3: padding (random) | Field 4: value |
 *
 * If Field 1 is zero, it means that Fields 2 and 3 do not exist. (Case when value.length =
 * totalLength -1)
 * If field 1 is 1 and field 2 is zero, it means that no field 3 exists. (Case when value.length
 * = totalLength - 2)
 *
 * Examples:
 *
 * | value             | totalLength | output bytes (r is random byte)        |
 * |                   |             |  F1     F2         F3           F4     |
 * | 0x04 0x05         |           3 | 0x00 <empty>   <empty>       0x04 0x05 |
 * | 0x04 0x05         |           4 | 0x01 0x00      <empty>       0x04 0x05 |
 * | 0x04 0x05         |           5 | 0x01 0x01      r             0x04 0x05 |
 * | 0x04 0x05         |           6 | 0x01 0x02      rr            0x04 0x05 |
 * | 0x04 0x05         |         258 | 0x01 0xFE      r(254 times)  0x04 0x05 |
 * | 0x04 0x05         |         259 | 0x01 0xFF      r(255 times)  0x04 0x05 |
 * | 0x04 0x05         |         260 | 0x02 0x00 0xFF r(255 times)  0x04 0x05 |
 * | 0x04 0x05         |         261 | 0x02 0x01 0x00 r(256 times)  0x04 0x05 |
 *
 * @param value - The value that shall be padded.
 * @param totalLength - The length of the final padding. Note that this value needs to be at
 * least 1 byte larger than value.length due to the byte that stores the padding length information.
 */
export function addPadding(value: Uint8Array, totalLength: number): Uint8Array {
    if (totalLength > Number.MAX_SAFE_INTEGER) {
        throw new Error('totalLength must not be larger than Number.MAX_SAFE_INTEGER');
    }

    const totalPaddingLength = totalLength - value.length;
    if (totalPaddingLength < 1) {
        throw new Error('totalLength must always be one byte larger than value.length.');
    }

    // Calculate the optimal padding counts
    // F1 (number): paddingCount.lengthByteCount
    // F2 (number): paddingCount.randomByteCount
    const paddingCount = calculatePaddingCount(totalPaddingLength - 1);

    // Convert F2 from number to Uint8Array
    const paddingLength = convertNumberToUint8Array(
        paddingCount.randomByteCount,
        paddingCount.lengthByteCount
    );

    // Create the random padding F3
    const padding = tweetnacl.randomBytes(paddingCount.randomByteCount);

    // Calculate start offsets of the different elements
    const startPaddingLengthLength = 0; // Start of F1
    const startPaddingLength = 1; // Start of F2
    const startPadding = startPaddingLength + paddingCount.lengthByteCount; // Start of F3
    const startValue = startPadding + paddingCount.randomByteCount; // Start of F4

    // Write the data ad the corresponding start offsets
    const valuePadded = new Uint8Array(totalLength);
    valuePadded.set([paddingCount.lengthByteCount], startPaddingLengthLength); // F1
    valuePadded.set(paddingLength, startPaddingLength); // F2
    valuePadded.set(padding, startPadding); // F3
    valuePadded.set(value, startValue); // F4

    return valuePadded;
}

/**
 * Remove the padding from a padded value and return the original value.
 *
 * @param paddedValue
 */
export function removePadding(paddedValue: Uint8Array): Uint8Array {
    // Extract F1
    const paddingLengthLength = paddedValue[0] & 0x0f;

    // Extract F2
    const paddingLengthAsArrayArbitraryLength = new Uint8Array(
        paddedValue.buffer,
        paddedValue.byteOffset + 1,
        paddingLengthLength
    );
    const paddingLengthAsArrayEightBytes = addZeroPaddingAtBeginning(
        paddingLengthAsArrayArbitraryLength,
        8
    );
    const paddingLengthBigInt = new DataView(
        paddingLengthAsArrayEightBytes.buffer,
        paddingLengthAsArrayEightBytes.byteOffset
    ).getBigUint64(0);
    if (paddingLengthBigInt > Number.MAX_SAFE_INTEGER) {
        throw new Error('paddingLength must not be larger than Number.MAX_SAFE_INTEGER');
    }
    const paddingLength = Number(paddingLengthBigInt);

    // We can ignore F3 - just random values

    // Extract F4
    const startOfValue = 1 + paddingLengthLength + paddingLength;
    if (startOfValue > Number.MAX_SAFE_INTEGER) {
        throw new Error('startOfValue must not be larger than Number.MAX_SAFE_INTEGER');
    }
    return new Uint8Array(paddedValue.buffer, paddedValue.byteOffset + startOfValue);
}

export function addPaddingWithExtraFlags(
    value: Uint8Array,
    totalLength: number,
    flags: number
): Uint8Array {
    if ((flags | 0x0f) !== 0x0f) {
        throw new Error('Only four bits in extra flags can be stored.');
    }

    const paddedValue = addPadding(value, totalLength);
    paddedValue[0] = paddedValue[0] | (flags << 4);
    return paddedValue;
}

export function removePaddingWithExtraFlags(paddedValue: Uint8Array): {
    value: Uint8Array;
    flags: number;
} {
    return {
        value: removePadding(paddedValue),
        flags: (paddedValue[0] & 0xf0) >> 4
    };
}
