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

// Only verified immutable JSON is cached. Promise entries coalesce concurrent reads; at most four objects survive.
const JSON_CACHE_LIMIT = 4;
const parsedObjects = new Map();
async function readJsonObject(env, sha) {
  if (parsedObjects.has(sha)) {
    const cached = parsedObjects.get(sha);
    parsedObjects.delete(sha);
    parsedObjects.set(sha, cached);
    return cached;
  }
  const pending = (async () => {
    const bytes = await readObject(env, sha);
    if (!bytes) throw new Error('JSON object missing: ' + sha);
    return JSON.parse(new TextDecoder().decode(bytes));
  })();
  parsedObjects.set(sha, pending);
  while (parsedObjects.size > JSON_CACHE_LIMIT) parsedObjects.delete(parsedObjects.keys().next().value);
  try {
    return await pending;
  } catch (error) {
    if (parsedObjects.get(sha) === pending) parsedObjects.delete(sha);
    throw error;
  }
}

function sourceDocuments(provenance, identifier, ancestors = new Set(), found = new Set()) {
  if (ancestors.has(identifier)) throw new Error('cyclic provenance operands');
  const entry = provenance.entries?.[identifier];
  if (!entry || !Object.hasOwn(provenance.documents || {}, entry.document)) throw new Error('provenance document does not resolve');
  found.add(entry.document);
  const next = new Set(ancestors).add(identifier);
  for (const operand of entry.operands || []) sourceDocuments(provenance, operand, next, found);
  return found;
}

async function provenance(env, rid, man, record) {
  const out = id => man.json.outputs.find(o => o.dataset === id);
  if (record.startsWith('budget2027/')) {
    const index = out('budget2027-provenance');
    if (!index) return json({ error: 'this release has no budget2027 provenance index' }, 404);
    const id = record.slice('budget2027/'.length);
    const provenance = await readJsonObject(env, index.sha256);
    const entry = provenance.entries?.[id];
    if (!entry) return json({ error: 'no such budget2027 provenance record' }, 404);
    let documents;
    try {
      documents = sourceDocuments(provenance, id);
    } catch (error) {
      return json({ error: error.message }, 404);
    }
    // Manifest membership is release-specific and must be checked even when the parsed object is cached.
    for (const name of documents) {
      const document = provenance.documents[name];
      const original = man.json.inputs.find(input => input.path === document.archive && input.sha256 === document.archiveSha256);
      if (!original) return json({ error: 'provenance original is not in this manifest' }, 404);
    }
    const document = provenance.documents[entry.document];
    const { document: documentReference, ...details } = entry;
    // Printed/extracted records retain the original API fields; derived records retain only their operation and operands.
    const resolved = entry.extraction ? { ...document, ...details } : details;
    const [file, pointer] = resolved.output.split('#');
    const output = man.json.outputs.find(o => o.path === `data/${file}`);
    if (!output) return json({ error: 'provenance output is not in this manifest' }, 404);
    const dataset = await readJsonObject(env, output.sha256);
    const cell = pointer.split('/').slice(1).reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], dataset);
    if (!cell || cell.provenance !== id) return json({ error: 'provenance output pointer does not resolve' }, 404);
    const original = resolved.archive ? man.json.inputs.find(i => i.path === resolved.archive && i.sha256 === resolved.archiveSha256) : null;
    if (resolved.archive && !original) return json({ error: 'provenance original is not in this manifest' }, 404);
    return json({ release_id: rid, record, ...cell, ...resolved,
      original: original ? { download: `/data/releases/${rid}/${original.path}`, member: resolved.member, memberSha256: resolved.memberSha256, page: entry.page } : undefined,
    }, 200, { 'Cache-Control': IMMUTABLE });
  }
  const pe = out('execution-provenance'), ee = out('execution');
  if (!pe || !ee) return json({ error: 'this release has no provenance index' }, 404);
  const p = await readJsonObject(env, pe.sha256);
  const ex = await readJsonObject(env, ee.sha256);
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
  let parts;
  try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); }
  catch { return json({ error: 'malformed path encoding' }, 400); }
  const integer = (name, fallback, max) => {
    const values = url.searchParams.getAll(name);
    if (!values.length) return fallback;
    const value = values[0];
    const n = Number(value);
    return values.length === 1 && /^\d+$/.test(value) && Number.isSafeInteger(n) && n >= 1 && n <= max ? n : null;
  };
  const limit = integer('limit', 20, 100);
  const before = integer('before', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (limit === null || before === null) return json({ error: 'limit must be an integer from 1 to 100; before must be a positive safe integer' }, 400);
  if (!env.DB || !env.OBJECTS) return json({ error: 'this environment has no release registry yet' }, 503);
  if (parts[0] === 'api' && parts.length === 2) {                                         // /api/releases
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
