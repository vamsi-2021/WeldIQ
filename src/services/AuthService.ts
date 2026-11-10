import axios, { AxiosError } from 'axios';

import { KEYCLOAK_CLIENT_ID, KEYCLOAK_ISSUER, KEYCLOAK_SCOPE } from '../config';

/** Signed-in user, read from the access token's claims. */
export interface AuthUser {
  /** Keycloak user ID (`sub`). */
  id: string;
  email: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  /** Realm roles, e.g. "Students", "license:bits-docs:full". */
  roles: string[];
}

export interface AuthSession {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  idToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  /** Epoch ms when the refresh token expires; after this the user must sign in again. */
  refreshExpiresAt?: number;
  /** Scopes the server actually granted. */
  scope: string[];
  user: AuthUser;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  id_token?: string;
  scope?: string;
  session_state?: string;
}

interface AccessTokenClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: { roles?: string[] };
}

interface KeycloakErrorBody {
  error?: string;
  error_description?: string;
}

const TOKEN_URL = `${KEYCLOAK_ISSUER}/protocol/openid-connect/token`;

function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function requestToken(fields: Record<string, string>): Promise<TokenResponse> {
  const res = await axios.post<TokenResponse>(TOKEN_URL, form({ client_id: KEYCLOAK_CLIENT_ID, ...fields }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });
  return res.data;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes a base64url string to UTF-8 text. */
/* eslint-disable no-bitwise */
function base64UrlDecode(input: string): string {
  const str = input.replace(/-/g, '+').replace(/_/g, '/').replace(/[=]+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of str) {
    const v = B64.indexOf(ch);
    if (v < 0) {
      throw new Error('Invalid base64 in token.');
    }
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // Percent-encode each byte so decodeURIComponent turns UTF-8 sequences into text.
  return decodeURIComponent(bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join(''));
}
/* eslint-enable no-bitwise */

/** Reads a JWT's payload. Does not verify the signature — the server does that. */
export function decodeJwt<T>(token: string): T {
  const payload = token.split('.')[1];
  if (!payload) {
    throw new Error('Malformed token.');
  }
  return JSON.parse(base64UrlDecode(payload)) as T;
}

function toSession(t: TokenResponse, fallbackEmail: string): AuthSession {
  const now = Date.now();
  const claims = decodeJwt<AccessTokenClaims>(t.access_token);
  return {
    accessToken: t.access_token,
    tokenType: t.token_type ?? 'Bearer',
    refreshToken: t.refresh_token,
    idToken: t.id_token,
    expiresAt: now + t.expires_in * 1000,
    refreshExpiresAt: t.refresh_expires_in ? now + t.refresh_expires_in * 1000 : undefined,
    scope: t.scope ? t.scope.split(' ') : [],
    user: {
      id: claims.sub,
      email: claims.email ?? claims.preferred_username ?? fallbackEmail,
      name: claims.name,
      givenName: claims.given_name,
      familyName: claims.family_name,
      roles: claims.realm_access?.roles ?? [],
    },
  };
}

/** Value for the Authorization header on API calls. */
export function authHeader(session: AuthSession): string {
  return `${session.tokenType} ${session.accessToken}`;
}

/** True when the access token is expired or about to expire (within `skewMs`). */
export function isExpired(session: AuthSession, skewMs = 60_000): boolean {
  return Date.now() >= session.expiresAt - skewMs;
}

/** Signs in with Keycloak's resource-owner password grant. */
export async function signIn(email: string, password: string): Promise<AuthSession> {
  const t = await requestToken({ grant_type: 'password', username: email, password, scope: KEYCLOAK_SCOPE });
  return toSession(t, email);
}

export async function refresh(session: AuthSession): Promise<AuthSession> {
  if (!session.refreshToken) {
    throw new Error('No refresh token; sign in again.');
  }
  const t = await requestToken({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
  return toSession(t, session.user.email);
}

/** Turns Keycloak / network errors into a short message for the login screen. */
export function describeAuthError(err: unknown): string {
  const e = err as AxiosError<KeycloakErrorBody>;
  if (e?.isAxiosError) {
    const code = e.response?.data?.error;
    if (code === 'invalid_grant') {
      return 'Incorrect email or password.';
    }
    if (code === 'invalid_client' || code === 'unauthorized_client') {
      return `Sign-in is misconfigured (${code}). Check KEYCLOAK_CLIENT_ID in src/config.ts.`;
    }
    if (e.response) {
      return e.response.data?.error_description ?? `Sign-in failed (${e.response.status}).`;
    }
    return 'Cannot reach the sign-in server. Check your connection.';
  }
  return err instanceof Error ? err.message : String(err);
}
