export type MapKeyType<M extends Map<any, any>> = M extends Map<infer K, any> ? K : never;
export type MapValueType<M extends Map<any, any>> = M extends Map<any, infer V> ? V : never;

/**
 * This function returns a map entry or v that is added to the map.
 *
 * @param map
 * @param k
 * @param v
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

export function isLastKey<M extends Map<any, any>>(map: M, k: MapKeyType<M>): boolean {
    const keys = [...map.keys()];
    return k === keys[keys.length - 1];
}

export function isLastValue<M extends Map<any, any>>(map: M, v: MapValueType<M>): boolean {
    const values = [...map.values()];
    return v === values[values.length - 1];
}

export function isLastEntry<M extends Map<any, any>>(
    map: M,
    e: [MapKeyType<M>, MapValueType<M>]
): boolean {
    const entries = [...map.entries()];
    return e[0] === entries[entries.length - 1][0] && e[1] === entries[entries.length - 1][1];
}
