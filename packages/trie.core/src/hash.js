import { createCryptoHash } from '@refinio/one.core/lib/system/crypto-helpers.js';
export const sha256HashFn = async (data) => {
    return await createCryptoHash(data);
};
