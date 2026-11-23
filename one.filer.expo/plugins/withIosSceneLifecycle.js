const {
  createRunOncePlugin,
  withAppDelegate,
  withInfoPlist,
} = require('@expo/config-plugins');

const SCENE_CONFIG_NAME = 'Default Configuration';
const SCENE_DELEGATE_CLASS = 'EXExpoAppSceneDelegate';

const LEGACY_WINDOW_BLOCK = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

`;

const SCENE_CONFIGURATION_METHOD = `
#if os(iOS) || os(tvOS)
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "${SCENE_CONFIG_NAME}",
      sessionRole: connectingSceneSession.role
    )
    configuration.delegateClass = ExpoAppSceneDelegate.self
    return configuration
  }
#endif
`;

function withIosSceneManifest(config) {
  return withInfoPlist(config, (modConfig) => {
    modConfig.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: SCENE_CONFIG_NAME,
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    };
    return modConfig;
  });
}

function withIosSceneAppDelegate(config) {
  return withAppDelegate(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    if (!contents.includes('ExpoReactNativeFactoryProvider')) {
      if (!contents.includes('class AppDelegate: ExpoAppDelegate {')) {
        throw new Error(
          '[withIosSceneLifecycle] Expected `class AppDelegate: ExpoAppDelegate {` in AppDelegate.swift.',
        );
      }
      contents = contents.replace(
        'class AppDelegate: ExpoAppDelegate {',
        'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {',
      );
    }

    if (contents.includes(LEGACY_WINDOW_BLOCK)) {
      contents = contents.replace(LEGACY_WINDOW_BLOCK, '');
    }

    if (!contents.includes('configurationForConnecting connectingSceneSession: UISceneSession')) {
      const anchor = '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)\n  }\n';
      if (!contents.includes(anchor)) {
        throw new Error(
          '[withIosSceneLifecycle] Expected didFinishLaunchingWithOptions return anchor in AppDelegate.swift.',
        );
      }
      contents = contents.replace(anchor, `${anchor}${SCENE_CONFIGURATION_METHOD}`);
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

function withIosSceneLifecycle(config) {
  config = withIosSceneManifest(config);
  config = withIosSceneAppDelegate(config);
  return config;
}

module.exports = createRunOncePlugin(withIosSceneLifecycle, 'withIosSceneLifecycle', '1.0.0');
