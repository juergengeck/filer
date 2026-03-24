/* eslint-disable no-restricted-syntax */

// the next day there is an error again. This is just for browser tests anyway, not for working
// with the code.
const {fromByteArray, toByteArray} = (globalThis as any).base64js;

export {fromByteArray, toByteArray};
export default (globalThis as any).base64js;
