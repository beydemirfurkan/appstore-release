// What the preflight rules know, in one place, each block with its source.
// Checked 2026-10-10 against the App Store Review Guidelines of June 8, 2026,
// Apple's developer documentation, the expo/expo plugin sources and npm.

/**
 * Expo config plugins that set usage descriptions: package → the Info.plist keys
 * it sets, the plugin option for each, and the default text used when the option
 * is not given. Precedence in @expo/config-plugins `applyPermissions`: plugin
 * option, then `ios.infoPlist`, then the default; `false` removes the key.
 * Source: github.com/expo/expo packages/<pkg>/plugin/src/*.ts (main, 2026-10).
 *
 * @type {Record<string, Array<{ key: string, option: string, default: string }>>}
 */
export const EXPO_PERMISSION_PLUGINS = {
  "expo-camera": [
    {
      key: "NSCameraUsageDescription",
      option: "cameraPermission",
      default: "Allow $(PRODUCT_NAME) to access your camera",
    },
    {
      key: "NSMicrophoneUsageDescription",
      option: "microphonePermission",
      default: "Allow $(PRODUCT_NAME) to access your microphone",
    },
  ],
  "expo-image-picker": [
    {
      key: "NSPhotoLibraryUsageDescription",
      option: "photosPermission",
      default: "Allow $(PRODUCT_NAME) to access your photos",
    },
    {
      key: "NSCameraUsageDescription",
      option: "cameraPermission",
      default: "Allow $(PRODUCT_NAME) to access your camera",
    },
    {
      key: "NSMicrophoneUsageDescription",
      option: "microphonePermission",
      default: "Allow $(PRODUCT_NAME) to access your microphone",
    },
  ],
  "expo-location": [
    {
      key: "NSLocationWhenInUseUsageDescription",
      option: "locationWhenInUsePermission",
      default: "Allow $(PRODUCT_NAME) to access your location",
    },
  ],
  "expo-contacts": [
    {
      key: "NSContactsUsageDescription",
      option: "contactsPermission",
      default: "Allow $(PRODUCT_NAME) to access your contacts",
    },
  ],
  "expo-media-library": [
    {
      key: "NSPhotoLibraryUsageDescription",
      option: "photosPermission",
      default: "Allow $(PRODUCT_NAME) to access your photos",
    },
    {
      key: "NSPhotoLibraryAddUsageDescription",
      option: "savePhotosPermission",
      default: "Allow $(PRODUCT_NAME) to save photos",
    },
  ],
  "expo-calendar": [
    {
      key: "NSCalendarsUsageDescription",
      option: "calendarPermission",
      default: "Allow $(PRODUCT_NAME) to access your calendars",
    },
  ],
  "expo-audio": [
    {
      key: "NSMicrophoneUsageDescription",
      option: "microphonePermission",
      default: "Allow $(PRODUCT_NAME) to access your microphone",
    },
  ],
  "expo-av": [
    {
      key: "NSMicrophoneUsageDescription",
      option: "microphonePermission",
      default: "Allow $(PRODUCT_NAME) to access your microphone",
    },
  ],
  "expo-tracking-transparency": [
    {
      key: "NSUserTrackingUsageDescription",
      option: "userTrackingPermission",
      default: "Allow this app to collect app-related data that can be used for tracking you or your device.",
    },
  ],
  "expo-local-authentication": [
    { key: "NSFaceIDUsageDescription", option: "faceIDPermission", default: "Allow $(PRODUCT_NAME) to use Face ID" },
  ],
  "expo-sensors": [
    {
      key: "NSMotionUsageDescription",
      option: "motionPermission",
      default: "Allow $(PRODUCT_NAME) to access your device motion",
    },
  ],
};

/** Every default text above, plus the location and calendar variants the plugins also set. */
export const EXPO_DEFAULT_TEXTS = new Set([
  ...Object.values(EXPO_PERMISSION_PLUGINS).flatMap((list) => list.map((p) => p.default)),
  "Allow $(PRODUCT_NAME) to detect your current motion activity",
  "Allow $(PRODUCT_NAME) to access your precise location",
  "Allow $(PRODUCT_NAME) to add events to your calendars",
  "Allow $(PRODUCT_NAME) to access your reminders",
  "Allow $(PRODUCT_NAME) to use speech recognition.",
  "Allow $(PRODUCT_NAME) to use the microphone.",
]);

/**
 * Native APIs that need a usage description, by the symbol that gives them away
 * in Swift or Objective-C. Source: Apple's "Protected resources" documentation
 * for each framework.
 *
 * @type {Array<{ symbol: RegExp, key: string, what: string }>}
 */
export const NATIVE_PERMISSION_SYMBOLS = [
  { symbol: /\bAVCaptureDevice\b/, key: "NSCameraUsageDescription", what: "the camera" },
  {
    symbol: /\brequestRecordPermission\b|\bAVAudioRecorder\b/,
    key: "NSMicrophoneUsageDescription",
    what: "the microphone",
  },
  { symbol: /\bCLLocationManager\b/, key: "NSLocationWhenInUseUsageDescription", what: "location" },
  { symbol: /\bPHPhotoLibrary\b(?!.*addOnly)/, key: "NSPhotoLibraryUsageDescription", what: "the photo library" },
  { symbol: /\bCNContactStore\b/, key: "NSContactsUsageDescription", what: "contacts" },
  { symbol: /\bEKEventStore\b/, key: "NSCalendarsFullAccessUsageDescription", what: "calendars" },
  { symbol: /\bLAContext\b.*\bbiometry|\bevaluatePolicy\b/, key: "NSFaceIDUsageDescription", what: "Face ID" },
  {
    symbol: /\bATTrackingManager\b/,
    key: "NSUserTrackingUsageDescription",
    what: "tracking (App Tracking Transparency)",
  },
  { symbol: /\bCMMotionActivityManager\b|\bCMPedometer\b/, key: "NSMotionUsageDescription", what: "motion activity" },
  { symbol: /\bSFSpeechRecognizer\b/, key: "NSSpeechRecognitionUsageDescription", what: "speech recognition" },
  { symbol: /\bCBCentralManager\b/, key: "NSBluetoothAlwaysUsageDescription", what: "Bluetooth" },
];

/**
 * Valid reason codes per required-reason API category. Source:
 * developer.apple.com/documentation/bundleresources/app-privacy-configuration/
 * nsprivacyaccessedapitypes/nsprivacyaccessedapitype (and …/describing-use-of-
 * required-reason-api). "Starting May 1, 2024, apps that don't describe their use
 * of required reason API in their privacy manifest file aren't accepted."
 */
export const REQUIRED_REASON_CODES = {
  NSPrivacyAccessedAPICategoryFileTimestamp: ["DDA9.1", "C617.1", "3B52.1", "0A2A.1"],
  NSPrivacyAccessedAPICategorySystemBootTime: ["35F9.1", "8FFB.1", "3D61.1"],
  NSPrivacyAccessedAPICategoryDiskSpace: ["85F4.1", "E174.1", "7D9E.1", "B728.1"],
  NSPrivacyAccessedAPICategoryActiveKeyboards: ["3EC4.1", "54BD.1"],
  NSPrivacyAccessedAPICategoryUserDefaults: ["CA92.1", "1C8F.1", "C56D.1", "AC6B.1"],
};

/**
 * npm packages that bring an SDK from Apple's list of commonly used third-party
 * SDKs, which must ship their own privacy manifest and signature.
 * Source: developer.apple.com/support/third-party-SDK-requirements (86 names);
 * package → pod checked against each package's podspec.
 *
 * @type {Record<string, string>}
 */
export const LISTED_SDK_PACKAGES = {
  "react-native-fbsdk-next": "FBSDKCoreKit, FBSDKLoginKit, FBSDKShareKit",
  "@react-native-google-signin/google-signin": "GoogleSignIn, AppAuth, GTMAppAuth, GTMSessionFetcher",
  "react-native-app-auth": "AppAuth",
  "react-native-onesignal": "OneSignal",
  "onesignal-expo-plugin": "OneSignal",
  "lottie-react-native": "Lottie",
  "expo-image": "SDWebImage",
  "react-native-fast-image": "SDWebImage",
};
/** `@react-native-firebase/*` brings Firebase and its Google dependencies. */
export const LISTED_SDK_PREFIXES = { "@react-native-firebase/": "Firebase (FirebaseCore, GoogleUtilities, …)" };

/** Third-party or social login: Guideline 4.8 asks for an equivalent private option alongside. */
export const SOCIAL_LOGIN_PACKAGES = [
  "@react-native-google-signin/google-signin",
  "react-native-fbsdk-next",
  "react-native-auth0",
  "react-native-app-auth",
];
export const APPLE_LOGIN_PACKAGES = ["expo-apple-authentication", "@invertase/react-native-apple-authentication"];

/** Accounts exist when any of these are present (or sign-up code is found). */
export const AUTH_PACKAGES = [
  ...SOCIAL_LOGIN_PACKAGES,
  ...APPLE_LOGIN_PACKAGES,
  "@react-native-firebase/auth",
  "@clerk/clerk-expo",
  "@supabase/supabase-js",
  "aws-amplify",
  "better-auth",
  "@better-auth/expo",
];

/** Payment SDKs that are not In-App Purchase. Guideline 3.1.1 for digital goods. */
export const EXTERNAL_PAYMENT_PACKAGES = [
  "@stripe/stripe-react-native",
  "react-native-paypal",
  "react-native-braintree-dropin-ui",
];
export const IAP_PACKAGES = [
  "react-native-purchases",
  "react-native-purchases-ui",
  "expo-iap",
  "react-native-iap",
  "react-native-adapty",
  "expo-superwall",
  "@superwall/react-native-superwall",
];

/** Advertising or attribution SDKs that usually mean tracking (Guideline 5.1.2(i), ATT). */
export const TRACKING_PACKAGES = ["react-native-google-mobile-ads", "react-native-fbsdk-next"];
export const ATT_PACKAGES = ["expo-tracking-transparency", "react-native-tracking-transparency"];
