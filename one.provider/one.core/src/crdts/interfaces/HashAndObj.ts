import type {OneIdObjectTypes, OneObjectTypes} from '../../recipes.js';
import {isObject} from '../../util/type-checks-basic.js';
import {isHash, type SHA256Hash, type SHA256IdHash} from '../../util/type-checks.js';

export type HashAndObject =
    | {
          hash: SHA256Hash;
          obj: OneObjectTypes;
      }
    | {
          hash: SHA256IdHash;
          obj: OneIdObjectTypes;
      };

export function isHashAndObject(hashAndObject: any): hashAndObject is HashAndObject {
    return (
        isObject(hashAndObject) &&
        isHash(hashAndObject.hash) &&
        isObject(hashAndObject.obj) &&
        typeof hashAndObject.obj.$type$ === 'string'
    );
}
