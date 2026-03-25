import {createCryptoHash} from '@refinio/one.core/lib/system/crypto-helpers.js';
import type {Hash, HashFn} from './types.js';

export const sha256HashFn: HashFn = async (data: string): Promise<Hash> => {
    return await createCryptoHash(data) as unknown as Hash;
};
