/**
 * Calculate maximum element of array
 *
 * @param {T[]} arr
 * @param {function(*,*):number} compareFn
 * @returns {T | undefined} - The maximum element, or undefined if empty
 */
export function arrayMax<T>(arr: T[], compareFn: (a: T, b: T) => number): T | undefined {
    // Could be implemented better - sorting the whole array is unnecessary
    const sorted = [...arr].sort(compareFn);
    return sorted[sorted.length - 1];
}

/**
 * Calculate minimum element of array
 *
 * @param {T[]} arr
 * @param {function(*,*):number} compareFn
 * @returns {T | undefined} - The minimum element, or undefined if empty
 */
export function arrayMin<T>(arr: T[], compareFn: (a: T, b: T) => number): T | undefined {
    // Could be implemented better - sorting the whole array is unnecessary
    const sorted = [...arr].sort(compareFn);
    return sorted[0];
}

/**
 * Like array. map only that it preserves holes in arrays (sparse arrays)
 *
 * @template T
 * @template U
 * @param {T[]} arr
 * @param {function(T,number,T[]):U} callbackfn
 * @returns {U[]}
 */
export function sparseMap<T, U>(
    arr: T[],
    callbackfn: (value: T, index: number, array: T[]) => U
): U[] {
    const ret: U[] = new Array(arr.length);

    // eslint-disable-next-line @typescript-eslint/no-for-in-array
    for (const i in arr) {
        ret[i] = callbackfn(arr[i], parseInt(i, 10), arr);
    }

    return ret;
}

/**
 * Like Promise. all only that it preserves holes in input array (sparse arrays)
 *
 * @param {Array<PromiseLike<T> | T>} sparseValues
 * @returns {Promise<Array<Awaited<T>>>}
 */
export async function sparsePromiseAll<T>(
    sparseValues: Array<T | PromiseLike<T>>
): Promise<Array<Awaited<T>>> {
    const packedValues = [];
    const sparseIndexLUT = [];

    // eslint-disable-next-line @typescript-eslint/no-for-in-array
    for (const sparseIndex in sparseValues) {
        sparseIndexLUT.push(parseInt(sparseIndex, 10));
        packedValues.push(sparseValues[sparseIndex]);
    }

    const packedResults = await Promise.all(packedValues);
    const sparseResults: Array<Awaited<T>> = new Array(sparseValues.length);

    for (let packedIndex = 0; packedIndex < packedResults.length; ++packedIndex) {
        const sparseIndex = sparseIndexLUT[packedIndex];
        sparseResults[sparseIndex] = packedResults[packedIndex];
    }

    return sparseResults;
}

/**
 * Makes a sparse array with the passed values as elements.
 *
 * @template T
 * @param {Array<Array<number|T>>} values - Array of index, value pairs.
 * @param {number} minLength - minimum length of array. If an index in values is >= than
 * this, it will be resized
 * @returns {T[]}
 */
export function makeSparseArray<T>(values: Array<[number | string, T]>, minLength?: number): T[] {
    const ret = minLength === undefined ? new Array<T>() : new Array<T>(minLength);

    for (const [index, value] of values) {
        // @ts-ignore
        ret[index] = value;
    }

    return ret;
}
