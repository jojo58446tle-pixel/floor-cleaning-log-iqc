import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export function verifyPassword(password: string, encoded: string) {
  const [salt, expected] = encoded.split(':');
  if (!salt || !/^[a-f0-9]{128}$/.test(expected || '') || password.length > 256) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
// A configured direct password takes precedence; invalid configuration fails closed.
export function adminPasswordConfigured(direct: string, hash: string) {
  return direct !== '' ? direct.length >= 16 && direct.length <= 256 : !!hash;
}
export function verifyAdminPassword(password: unknown, direct: string, hash: string) {
  if (typeof password !== 'string' || password.length > 256 || !adminPasswordConfigured(direct, hash)) return false;
  if (direct === '') return verifyPassword(password, hash);
  // Fixed-size digests avoid leaking password length through the comparison.
  return timingSafeEqual(createHash('sha256').update(password).digest(), createHash('sha256').update(direct).digest());
}
export function makeSession(secret: string) {
  const csrf = randomBytes(24).toString('hex');
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 3600000, csrf })).toString('base64url');
  return { token: `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`, csrf };
}
export function readSession(cookie: string, secret: string) {
  if (secret.length < 32) return null;
  const token = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('__Host-cleaning='))?.slice(16);
  if (!token) return null;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', secret).update(payload || '').digest('base64url');
  if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return data.exp > Date.now() && typeof data.csrf === 'string' ? data : null; } catch { return null; }
}
export function sameOrigin(req: Request) { return req.headers.get('origin') === new URL(req.url).origin; }
export function cookieHeader(token: string, secure = true) { return `__Host-cleaning=${token}; Path=/; HttpOnly; SameSite=Strict; ${secure ? 'Secure; ' : ''}Max-Age=${token ? 28800 : 0}`; }
