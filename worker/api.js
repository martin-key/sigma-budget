// The public, read-only release API (docs/approach-specification.md, section 9.2). GET and HEAD only; nothing here writes.
//   GET /api/releases/current                         release_id, revision, the manifest URL and when it became current; no-store
//   GET /api/releases?before=<revision>&limit=<n>     the public journal: revision, release, kind, time, role and pseudonym (no operator)
//   GET /data/releases/:id/manifest.json              the exact bytes of the manifest
//   GET /data/releases/:id/:path                      a file listed in the manifest (an output or an original); immutable
//   GET /api/releases/:id/datasets/:dataset           the files of one dataset of the release, with the release ID and the schema
//   GET /api/releases/:id/provenance/<record>         where one number comes from: data/2026-09/kfp/rev -> the original, sheet and cell
// An unknown or never published release, or a file the manifest does not list, is 404: there is no fallback to another release.
import { HEX64, current, isPublic, json, manifestOf, objectKey, readObject } from './store.js';
import { pseudonym } from './access.js';

// no-transform: a release file is served with exactly the bytes of its sha256. Without it a zone feature that edits HTML on the way out
// (Web Analytics automatic setup inserts its beacon, Email Obfuscation, Rocket Loader) changes the originals, and they no longer hash.
const IMMUTABLE = 'public, max-age=31536000, immutable, no-transform';
// no-transform also keeps Cloudflare from compressing: the Worker compresses text itself (the runtime gzips a body sent with
// Content-Encoding). The client decodes it to the exact bytes of the sha256; a Range request and a client without gzip get them as they are.
const TEXTY = /^(text\/|application\/(json|xml|javascript)|image\/svg\+xml)/;
function encodingFor(request, mime) {
  if (!TEXTY.test(mime) || request.headers.has('Range')) return null;
  // the visitor's own Accept-Encoding: the header the Worker sees is rewritten by Cloudflare ("br, gzip" even for a client without gzip)
  const ae = String(request.cf?.clientAcceptEncoding ?? '').toLowerCase();
  return /\bgzip\b/.test(ae) ? 'gzip' : null;
}
const ACTIVE = new Set(['text/html', 'application/xml', 'image/svg+xml']);       // originals that a browser could run: a download, never a page

async function releaseOr404(env, rid) {
  if (!HEX64.test(rid) || !(await isPublic(env, rid))) return null;
  return manifestOf(env, rid);
}

async function serveObject(request, env, rid, entry) {
  const tag = `"${entry.sha256}"`;
  const headers = {
    'Content-Type': entry.mime + (/^text\/|json|xml/.test(entry.mime) && !/charset/.test(entry.mime) ? '; charset=utf-8' : ''),
    'Cache-Control': IMMUTABLE, ETag: tag, 'Accept-Ranges': 'bytes', 'X-Release-Id': rid, 'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  };
  if (ACTIVE.has(entry.mime)) {
    headers['Content-Disposition'] = `attachment; filename="${entry.path.split('/').pop()}"`;
    headers['Content-Security-Policy'] = 'sandbox';
  }
  const enc = encodingFor(request, entry.mime);
  if (enc) Object.assign(headers, { 'Content-Encoding': enc, ETag: 'W/' + tag, Vary: 'Accept-Encoding' });   // another representation: a weak tag
  if ((request.headers.get('If-None-Match') || '').split(',').map(s => s.trim().replace(/^W\//, '')).includes(tag)) return new Response(null, { status: 304, headers });
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  if (m && (m[1] || m[2])) {
    const size = entry.bytes;
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    const part = await env.OBJECTS.get(objectKey(entry.sha256), { range: { offset: start, length: end - start + 1 } });
    if (!part) return json({ error: 'object missing' }, 500);
    return new Response(request.method === 'HEAD' ? null : part.body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` } });
  }
  const buf = await readObject(env, entry.sha256);          // read whole and checked again: an object that does not hash to its key is not served
  if (!buf) return json({ error: 'object missing' }, 500);
  return new Response(request.method === 'HEAD' ? null : buf, { headers: enc ? headers : { ...headers, 'Content-Length': String(entry.bytes) } });
}

async function provenance(env, rid, man, record) {
  const out = id => man.json.outputs.find(o => o.dataset === id);
  const pe = out('execution-provenance'), ee = out('execution');
  if (!pe || !ee) return json({ error: 'this release has no provenance index' }, 404);
  const p = JSON.parse(new TextDecoder().decode(await readObject(env, pe.sha256)));
  const ex = JSON.parse(new TextDecoder().decode(await readObject(env, ee.sha256)));
  const r = /^(data|monthly)\/(\d{4})-(\d{2})\/(kfp|nat|eu)\/([a-z.]+)$/.exec(record);
  if (!r) return json({ error: 'a record is <data|monthly>/<YYYY-MM>/<kfp|nat|eu>/<row>, e.g. data/2026-09/kfp/rev' }, 400);
  const [, block, y, mm, col, row] = r;
  const i = Number(mm) - 1;
  const value = ex[block]?.[y]?.[col]?.[row]?.[i];
  if (value === undefined) return json({ error: 'no such value in execution.json of this release' }, 404);
  const base = { release_id: rid, record, value, unit: ex.contract?.money?.unit || ex.meta?.unit, data_schema: ex.meta?.schema || 'execution/1' };
  if (block === 'monthly') {
    const prev = i ? `data/${y}-${String(i).padStart(2, '0')}/${col}/${row}` : null;
    return json({ ...base, rule: p.rules?.monthly, from: [`data/${y}-${mm}/${col}/${row}`, prev].filter(Boolean) }, 200, { 'Cache-Control': IMMUTABLE });
  }
  const orig = p.originals?.[`${y}-${mm}`];
  if (!orig) return json({ error: 'no original for this month' }, 404);
  const input = man.json.inputs.find(o => o.sha256 === orig.sha256);
  const cell = p.rows?.[row] ? p.columns[col] + p.rows[row] : null;
  return json({
    ...base,
    original: { file: orig.file, sha256: orig.sha256, asOf: orig.asOf, unit: orig.unit, download: input ? `/data/releases/${rid}/${input.path}` : null,
                source: input?.source, page: input?.page },
    sheet: p.sheet, cell, computed: cell ? undefined : p.computed?.[row],
    rule: orig.unit === 'BGN' ? p.rules?.data : undefined,
  }, 200, { 'Cache-Control': IMMUTABLE });
}

export async function publicApi(request, env, url) {
  if (!env.DB || !env.OBJECTS) return json({ error: 'this environment has no release registry yet' }, 503);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'api' && parts.length === 2) {                                         // /api/releases
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
    const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
    const rows = (await env.DB.prepare('SELECT revision, release_id, previous_release_id, kind, operator, at FROM journal WHERE revision < ?1 ORDER BY revision DESC LIMIT ?2')
      .bind(before, limit).all()).results;
    const items = await Promise.all(rows.map(async r => ({ revision: r.revision, release_id: r.release_id, previous_release_id: r.previous_release_id,
      kind: r.kind, at: r.at, role: 'operator', by: await pseudonym(r.operator) })));
    const next = items.length === limit ? `/api/releases?before=${items[items.length - 1].revision}&limit=${limit}` : null;
    return json({ items, next });
  }
  if (parts[0] === 'api' && parts[2] === 'current' && parts.length === 3) {
    const c = await current(env);
    if (!c || !c.release_id) return json({ release_id: null, revision: c ? c.revision : 0, message: 'няма публикувано издание' }, 404);
    return json({ release_id: c.release_id, revision: c.revision, manifest: `/data/releases/${c.release_id}/manifest.json`, published: c.at, kind: c.kind });
  }
  const rid = parts[2];
  const man = await releaseOr404(env, rid);
  if (!man) return json({ error: 'no such public release' }, 404);
  if (parts[0] === 'data') {                                                                 // /data/releases/:id/...
    const rel = parts.slice(3).join('/');
    if (rel === 'manifest.json') return serveObject(request, env, rid, { path: 'manifest.json', sha256: rid, bytes: man.bytes.byteLength, mime: 'application/json' });
    const entry = man.json.outputs.find(o => o.path === rel) || man.json.inputs.find(o => o.path === rel);
    return entry ? serveObject(request, env, rid, entry) : json({ error: 'the manifest does not list ' + rel }, 404);
  }
  if (parts[3] === 'datasets' && parts.length === 5) {
    const files = man.json.outputs.filter(o => o.dataset === parts[4]);
    if (!files.length) return json({ error: 'no such dataset in this release' }, 404);
    return json({ release_id: rid, dataset: parts[4], data_schema: man.json.data_schema,
      files: files.map(o => ({ path: o.path, url: `/data/releases/${rid}/${o.path}`, sha256: o.sha256, bytes: o.bytes, mime: o.mime })) },
    200, { 'Cache-Control': IMMUTABLE });
  }
  if (parts[3] === 'provenance' && parts.length > 4) return provenance(env, rid, man, parts.slice(4).join('/'));
  return json({ error: 'not found' }, 404);
}
