/* eslint-disable jsdoc/require-returns,jsdoc/require-param-type */
export type MapKeyType<M extends Map<any, any>> = M extends Map<infer K, any> ? K : never;
export type MapValueType<M extends Map<any, any>> = M extends Map<any, infer V> ? V : never;

/**
 * This function returns a map entry or v that is added to the map.
 *
 * @param {Map} map
 * @param {MapKeyType} k
 * @param {MapValueType} v - The newly created element. If you specify a function the function
 *                           needs to return the new element. This is useful if creating an
 *                           element is expensive, and you only want to do it if it does not exist.
 */
export function getOrCreate<M extends Map<any, any>>(
    map: M,
    k: MapKeyType<M>,
    v: MapValueType<M> | (() => MapValueType<M>)
): MapValueType<M> {
    const value = map.get(k);

    if (value === undefined) {
        const newValue = typeof v === 'function' ? (v as () => MapValueType<M>)() : v;
        map.set(k, newValue);
        return newValue;
    } else {
        return value;
    }
}
