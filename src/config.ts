/** Port the BF Files server (POST /file-records) listens on. */
export const FILES_PORT = 3002;

/** Bucket scan zips are uploaded to. */
export const FILES_BUCKET = 'weld-iq';

/** BF Files server URL used for uploads. */
export const FILES_URL = 'http://138.47.142.63:3002';

/** Analytics server the uploaded scan is registered with (POST /api/analytics/weld-iq/scans). */
export const ANALYTICS_URL = 'http://138.47.142.63:5172';

/** Assignment the scan is attached to. Hardcoded for now. */
export const ASSIGNMENT_DETAIL_ID = 'cd65cf29-8fd7-4996-9257-a7751c3b63ee';

/** Keycloak realm used to sign in (OIDC password grant from the login screen). */
export const KEYCLOAK_ISSUER = 'https://keycloak.betaflixinc.com/realms/BetaFlix-Experiments';

/** Keycloak client the app signs in as (password grant / "Direct access grants"). */
export const KEYCLOAK_CLIENT_ID = 'user_client';

/** Scopes requested at sign-in. */
export const KEYCLOAK_SCOPE = 'lrs:statements/write openid profile email lrs:statements/read/mine';

/** Capture settings sent to the native scanner. */
export const SCAN_OPTIONS = {
  targetImageCount: 60,
  maxImageCount: 100,
  minAngleDeg: 8,
  minIntervalSec: 0.4,
  jpegQuality: 0.9,
  useHighResolutionFrames: true,
  maxImageDimension: 2560,
  saveDepth: true,
};

/** Fewer images than this rarely reconstructs; the server is expected to enforce the same minimum. */
export const MIN_IMAGES_FOR_RECONSTRUCTION = 10;

/** BF Files server for uploads. */
export function defaultFilesUrl(): string {
  return FILES_URL;
}
