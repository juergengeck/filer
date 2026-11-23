require('react-native-get-random-values');

if (
  typeof globalThis.crypto === 'undefined' ||
  typeof globalThis.crypto.getRandomValues !== 'function'
) {
  throw new Error('React Native crypto.getRandomValues bootstrap failed');
}

// Shared native UI uses the browser localStorage shape for small synchronous
// preferences before ONE.core authentication.
if (typeof globalThis.localStorage === 'undefined') {
  const nativeLocalStorage = new Map<string, string>();
  const storage = {
    get length() {
      return nativeLocalStorage.size;
    },
    clear() {
      nativeLocalStorage.clear();
    },
    getItem(key: string) {
      return nativeLocalStorage.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(nativeLocalStorage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      nativeLocalStorage.delete(String(key));
    },
    setItem(key: string, value: string) {
      nativeLocalStorage.set(String(key), String(value));
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  const reactNativeGlobal = globalThis as typeof globalThis & {
    global?: typeof globalThis & { localStorage?: Storage };
  };
  if (reactNativeGlobal.global && typeof reactNativeGlobal.global.localStorage === 'undefined') {
    Object.defineProperty(reactNativeGlobal.global, 'localStorage', {
      configurable: true,
      value: storage,
    });
  }
}

require('@refinio/one.core-expo/load-expo');
