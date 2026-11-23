const path = require('path');
const {getDefaultConfig} = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// ONE core exposes `load-expo` via an `import`-only export condition, which
// Metro's CJS `require()` in bootstrap.ts cannot resolve. Alias it at the
// source instead of shimming: no Node shims or stubs belong in this bundle —
// `@refinio/one.core-expo` implements the platform on `expo-crypto` and a
// leaking `crypto`/`fs`/`path` import is a bug in the offending package.
const EXACT_ALIASES = {
    '@refinio/one.core-expo/load-expo': path.resolve(
        projectRoot,
        'node_modules/@refinio/one.core-expo/dist/load-expo.js'
    )
};

const SINGLETON_MODULES = [
    'react',
    'react-native',
    'react-dom',
    'react-native-safe-area-context',
    'react-native-svg',
    // `load-expo` registers the PRNG via `tweetnacl.setPRNG`; it must patch
    // the same NaCl instance `@refinio/one.core` uses.
    'tweetnacl'
];

function isSingletonRequest(moduleName) {
    return SINGLETON_MODULES.some(
        name => moduleName === name || moduleName.startsWith(`${name}/`)
    );
}

// `react-native-svg` ships separate CJS/module/source entries; mixing them
// registers native views twice.
const reactNativeSvgEntry = path.resolve(
    projectRoot,
    'node_modules/react-native-svg/src/index.ts'
);

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (EXACT_ALIASES[moduleName]) {
        return context.resolveRequest(context, EXACT_ALIASES[moduleName], platform);
    }
    if (moduleName === 'react-native-svg') {
        return context.resolveRequest(context, reactNativeSvgEntry, platform);
    }
    if (isSingletonRequest(moduleName)) {
        return context.resolveRequest(
            {...context, originModulePath: path.join(projectRoot, 'package.json')},
            moduleName,
            platform
        );
    }
    if (typeof defaultResolveRequest === 'function') {
        return defaultResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
