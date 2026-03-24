/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2023
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * Utility module for reverse array iteration
 * @module
 */

/**
 * This function returns an iterator that performs reverse iteration over the given array. It
 * can be used with `for...of` loops, for example.
 *
 * Example usage:
 *
 * ```
 * const array = [1,2,3,4,5];
 * for (const item of getReverseIterator(array)) {
 *     console.log(item);
 * }
 * // Output: 5 4 3 2 1 (one number per line)
 *````
 * @param {Array<*>} arr
 * @returns {Iterable}
 */
export function getReverseIterator<T>(arr: T[]): Iterable<T> {
    return {
        [Symbol.iterator]() {
            let i = arr.length;
            return {
                next: () => ({
                    value: arr[--i],
                    done: i < 0
                })
            };
        }
    };
}
