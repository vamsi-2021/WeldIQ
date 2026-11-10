import { decodeJwt } from '../src/services/AuthService';

// Jest runs on Node, which provides Buffer; the app's tsconfig doesn't include Node types.
const NodeBuffer = (globalThis as any).Buffer;
const b64url = (o: object) => NodeBuffer.from(JSON.stringify(o)).toString('base64url');

test('decodeJwt reads claims, including non-ASCII names', () => {
  const claims = { sub: 'abc', name: 'José Ñúñez', realm_access: { roles: ['Students'] } };
  const token = `${b64url({ alg: 'none' })}.${b64url(claims)}.sig`;
  expect(decodeJwt(token)).toEqual(claims);
});
