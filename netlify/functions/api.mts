import type { Context, Config } from '@netlify/functions';
import { getStore, getDeployStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { DEFAULT_AREAS, GROUPS, images, recordKey, summary, validDate, validMonth, validateFields, type RecordData, type ImageGroup } from '../lib/model.ts';
import { cookieHeader, makeSession, readSession, sameOrigin, verifyPassword } from '../lib/auth.ts';
import { optimizeImage } from '../lib/image.ts';

function json(data: unknown, status = 200, cache = false, extra = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': cache ? 'public, max-age=0, must-revalidate' : 'no-store', 'Netlify-CDN-Cache-Control': cache ? 'public, s-maxage=15' : 'no-store', 'Vary': 'Cookie', 'Netlify-Vary': 'cookie=__Host-cleaning', ...extra } });
}
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function parseRecordQuery(url: URL) {
  const date = url.searchParams.get('date') || '', id = url.searchParams.get('id') || '';
  if (!validDate(date) || !/^[a-f0-9-]{36}$/.test(id)) fail('Invalid record reference.');
  return { date, id, key: recordKey(date, id) };
}
async function monthRecords(store: any, month: string): Promise<RecordData[]> {
  const list = await store.list({ prefix: `records/${month.replace('-', '/')}/` });
  const result: RecordData[] = [];
  // Bounded batches avoid issuing thousands of simultaneous requests.
  for (let i = 0; i < list.blobs.length; i += 20) {
    const rows = await Promise.all(list.blobs.slice(i, i + 20).map((b: any) => store.get(b.key, { type: 'json' })));
    result.push(...rows.filter(Boolean));
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}
export default async (req: Request, context: Context) => {
  try {
    const url = new URL(req.url), action = url.pathname.replace(/^\/api\/?/, '');
    const production = context.deploy.context === 'production';
    const store = production ? getStore({ name: 'cleaning-log', consistency: 'strong' }) : getDeployStore({ name: 'cleaning-log', consistency: 'strong' });
    const secret = Netlify.env.get('CLEANING_SESSION_SECRET') || '';
    const hash = Netlify.env.get('CLEANING_ADMIN_PASSWORD_HASH') || '';
    const session = readSession(req.headers.get('cookie') || '', secret);
    const write = !['GET', 'HEAD'].includes(req.method);
    if (write && !sameOrigin(req)) return json({ error: 'Same-origin request required.' }, 403);
    if (action === 'auth/login' && req.method === 'POST') {
      if (secret.length < 32 || !hash) return json({ error: 'Admin authentication has not been configured.' }, 503);
      if (Number(req.headers.get('content-length') || 0) > 2048) fail('Request too large.', 413);
      const { password } = await req.json();
      if (typeof password !== 'string' || !verifyPassword(password, hash)) return json({ error: 'Incorrect admin password.' }, 401);
      const next = makeSession(secret);
      return json({ authenticated: true, csrf: next.csrf }, 200, false, { 'Set-Cookie': cookieHeader(next.token) });
    }
    if (action === 'auth/session' && req.method === 'GET') return json({ authenticated: !!session, csrf: session?.csrf || null });
    if (write) {
      if (!session) return json({ error: 'Admin sign-in required.' }, 401);
      if (req.headers.get('x-csrf-token') !== session.csrf) return json({ error: 'Session verification failed. Sign in again.' }, 403);
    }
    if (action === 'auth/logout' && req.method === 'POST') return json({ ok: true }, 200, false, { 'Set-Cookie': cookieHeader('') });
    if (action === 'settings') {
      const settings = await store.get('settings.json', { type: 'json' }) || { areas: DEFAULT_AREAS, holidays: [] };
      if (req.method === 'GET') return json(settings, 200, !session);
      if (req.method === 'PUT') {
        const body = await req.json();
        if (!Array.isArray(body.areas) || body.areas.length < 1 || body.areas.length > 100 || body.areas.some((a: any) => typeof a !== 'string' || !a.trim() || a.length > 100)) fail('Provide 1–100 area names.');
        if (!Array.isArray(body.holidays) || body.holidays.length > 1000 || body.holidays.some((d: any) => typeof d !== 'string' || !validDate(d))) fail('Invalid holiday dates.');
        const next = { areas: [...new Set(body.areas.map((a: string) => a.trim()))], holidays: [...new Set(body.holidays)].sort() };
        await store.setJSON('settings.json', next); return json(next);
      }
    }
    if (action === 'records') {
      if (req.method === 'GET') {
        const month = url.searchParams.get('month') || '';
        if (!validMonth(month)) fail('Choose a valid month.');
        const rows = await monthRecords(store, month);
        const records = session ? rows : rows.filter(r => r.published);
        return json({ records, summary: summary(rows, month) }, 200, !session);
      }
      if (req.method === 'POST') {
        const settings = await store.get('settings.json', { type: 'json' }) || { areas: DEFAULT_AREAS };
        const fields = validateFields(await req.json(), settings.areas);
        const now = new Date().toISOString();
        const record: RecordData = { ...fields, id: randomUUID(), beforeImages: [], afterImages: [], additionalImages: [], published: false, createdAt: now, updatedAt: now };
        await store.setJSON(recordKey(record.date, record.id), record); return json({ record }, 201);
      }
    }
    if (action === 'record' || action === 'upload') {
      const { key, date, id } = parseRecordQuery(url);
      const entry = await store.getWithMetadata(key, { type: 'json' });
      const record: RecordData | null = entry?.data || null;
      if (!record || (!session && !record.published)) fail('Record not found.', 404);
      if (action === 'record' && req.method === 'GET') return json({ record }, 200, !session);
      if (action === 'record' && req.method === 'DELETE') {
        await store.delete(key);
        for (const photo of images(record)) { await store.delete(photo.fullKey); await store.delete(photo.thumbKey); }
        return json({ ok: true });
      }
      if (action === 'record' && req.method === 'PUT') {
        const body = await req.json();
        if (body.updatedAt !== record.updatedAt) fail('This record changed. Reload before editing.', 409);
        const settings = await store.get('settings.json', { type: 'json' }) || { areas: DEFAULT_AREAS };
        const fields = validateFields(body, [...new Set([...settings.areas, record.area])]);
        if (fields.date !== record.date) fail('Record date cannot change after creation. Create a new record for another date.');
        const removed = new Set(Array.isArray(body.removeImageIds) ? body.removeImageIds : []);
        const next = { ...record, ...fields, updatedAt: new Date().toISOString() };
        for (const group of GROUPS) next[`${group}Images`] = record[`${group}Images`].filter(p => !removed.has(p.id));
        if (body.publish === true) {
          if (!next.beforeImages.length || !next.afterImages.length) fail('Before and After photo evidence is required to publish.');
          next.published = true;
        }
        if (next.published && (!next.beforeImages.length || !next.afterImages.length)) fail('Published records must keep Before and After photo evidence.');
        const saved = await store.setJSON(key, next, { onlyIfMatch: entry.etag });
        if (!saved.modified) fail('This record changed. Reload before editing.', 409);
        for (const photo of images(record).filter(p => removed.has(p.id))) { await store.delete(photo.fullKey); await store.delete(photo.thumbKey); }
        return json({ record: next });
      }
      if (action === 'upload' && req.method === 'POST') {
        const group = url.searchParams.get('group') as ImageGroup;
        if (!GROUPS.includes(group)) fail('Choose Before, After or Additional.');
        if (images(record).length >= 30) fail('Maximum 30 photos per activity.');
        if (Number(req.headers.get('content-length') || 0) > 4500000) fail('Photo is too large. Please retry using automatic compression.', 413);
        const data = Buffer.from(await req.arrayBuffer());
        if (!data.length || data.length > 4500000) fail('Photo must be under 4.5 MB.', 413);
        let optimized;
        try { optimized = await optimizeImage(data); } catch { fail('Photo cannot be decoded. Use JPEG, PNG or WebP.', 422); }
        const photoId = randomUUID(), prefix = `images/${date.replaceAll('-', '/')}/${id}/`;
        const fullKey = `${prefix}${group}-${photoId}.webp`, thumbKey = `${prefix}thumb-${group}-${photoId}.webp`;
        try {
          await store.set(fullKey, new Blob([new Uint8Array(optimized.full)]));
          await store.set(thumbKey, new Blob([new Uint8Array(optimized.thumb)]));
          const photo = { id: photoId, fullKey, thumbKey, width: optimized.width, height: optimized.height, bytes: optimized.full.length, thumbBytes: optimized.thumb.length };
          record[`${group}Images`].push(photo); record.updatedAt = new Date().toISOString();
          const saved = await store.setJSON(key, record, { onlyIfMatch: entry.etag });
          if (!saved.modified) fail('This record changed during upload. Reload and retry.', 409);
          return json({ photo, record }, 201);
        } catch (e) { await store.delete(fullKey); await store.delete(thumbKey); throw e; }
      }
    }
    if (action === 'image' && req.method === 'GET') {
      const { key } = parseRecordQuery(url);
      const record: RecordData | null = await store.get(key, { type: 'json' });
      if (!record || (!session && !record.published)) fail('Photo not found.', 404);
      const photo = images(record).find(p => p.id === url.searchParams.get('photo'));
      if (!photo) fail('Photo not found.', 404);
      const image = await store.get(url.searchParams.get('size') === 'thumb' ? photo.thumbKey : photo.fullKey, { type: 'arrayBuffer' });
      if (!image) fail('Photo not found.', 404);
      return new Response(image, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': session ? 'no-store' : 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (action === 'statistics' && req.method === 'GET') {
      const end = url.searchParams.get('month') || '';
      if (!validMonth(end)) fail('Choose a valid month.');
      const [year, month] = end.split('-').map(Number), rows = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(year, month - 1 - i, 1)), m = d.toISOString().slice(0, 7);
        rows.push(summary(await monthRecords(store, m), m));
      }
      return json({ months: rows }, 200, !session);
    }
    return json({ error: 'Route or method not found.' }, 404);
  } catch (e: any) {
    const status = e.status || (e.message?.includes('Choose') || e.message?.includes('must') || e.message?.includes('Finish') || e.message?.includes('Activity') || e.message?.includes('Note') ? 400 : 500);
    if (status === 500) console.error('Cleaning API failure', e.message);
    return json({ error: status === 500 ? 'Unable to complete this request. Please retry.' : e.message }, status);
  }
};
export const config: Config = { path: '/api/*', excludedPath: ['/api/auth/login'], rateLimit: { windowLimit: 600, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
