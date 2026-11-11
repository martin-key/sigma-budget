// Objects (R2) and the release registry (D1), shared by the public and the operator API (docs/approach-specification.md, section 7).
//   objects/sha256/<digest>      the verified bytes, content-addressed; the key of a manifest is its sha256, which is the release_id
//   uploads/<operation>/<digest> where an upload lands before the server has read it back; never public
// Nothing here overwrites or deletes a published object: the only delete is of a temporary upload.
export const MANIFEST_SCHEMA = 'budget-release/1';
export const SUPPORTED = { execution: ['execution/1', 'execution/2'] }; // the data contracts this code reads (section 10.1)
export const HEX64 = /^[0-9a-f]{64}$/;
// a path of segments of letters, digits, . _ - and single inner spaces (the programme budgets: „0100_Народно събрание.pdf“);
// no leading /, no empty, . or .. segment, at most 300 characters
const SEG = '[\\p{L}\\p{N}._\\-]+(?: [\\p{L}\\p{N}._\\-]+)*';
const SAFE_PATH = new RegExp(`^(?!.*(?:^|/)\\.\\.?(?:/|$))(?=.{1,300}$)${SEG}(?:/${SEG})*$`, 'u');
const MIMES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'text/html',
  'text/plain',
  'text/csv',
  'application/pdf',
  'application/zip',
  'application/x-7z-compressed',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rss+xml',
]);

export const objectKey = (sha) => `objects/sha256/${sha}`;
export const uploadKey = (op, sha) => `uploads/${op}/${sha}`;
export const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
export const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (data) =>
  hex(
    await crypto.subtle.digest(
      'SHA-256',
      typeof data === 'string' ? new TextEncoder().encode(data) : data,
    ),
  );
export const maxBytes = (env) => Number(env.MAX_OBJECT_BYTES || 50 * 1024 * 1024);

/** reads that decide the result of a publish use the primary (section 7.3), not a replica that may lag */
export const primary = (env) =>
  typeof env.DB.withSession === 'function' ? env.DB.withSession('first-primary') : env.DB;

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });

/** the structural checks of a manifest the server can make itself (section 7.2, step 4): it does not repeat the Python processing */
export function checkManifest(m, env) {
  const problems = [];
  const need = (cond, msg) => {
    if (!cond) problems.push(msg);
  };
  need(m && typeof m === 'object' && !Array.isArray(m), 'the manifest is not a JSON object');
  if (problems.length) return { problems, objects: [] };
  need(m.manifest_schema === MANIFEST_SCHEMA, `manifest_schema must be ${MANIFEST_SCHEMA}`);
  need(m.data_schema && typeof m.data_schema === 'object', 'data_schema is missing');
  for (const [k, ok] of Object.entries(SUPPORTED)) {
    if (m.data_schema && m.data_schema[k] !== undefined)
      need(
        ok.includes(m.data_schema[k]),
        `data_schema.${k} ${m.data_schema[k]} is not supported by this code (${ok.join(', ')})`,
      );
  }
  need(
    /^[0-9a-f]{40}$/.test(m.processing?.code?.commit || ''),
    'processing.code.commit is not a commit',
  );
  const objects = new Map();
  for (const role of ['inputs', 'outputs']) {
    need(Array.isArray(m[role]), `${role} is not a list`);
    const paths = new Set();
    for (const o of Array.isArray(m[role]) ? m[role] : []) {
      need(SAFE_PATH.test(o.path || ''), `${role}: unsafe path ${String(o.path).slice(0, 80)}`);
      need(!paths.has(o.path), `${role}: ${o.path} twice`);
      paths.add(o.path);
      need(HEX64.test(o.sha256 || ''), `${role}: ${o.path} has no sha256`);
      need(
        Number.isInteger(o.bytes) && o.bytes >= 0 && o.bytes <= maxBytes(env),
        `${role}: ${o.path} has ${o.bytes} bytes (limit ${maxBytes(env)})`,
      );
      need(MIMES.has(o.mime), `${role}: ${o.path} has the media type ${o.mime}`);
      const seen = objects.get(o.sha256);
      need(!seen || seen.bytes === o.bytes, `${o.sha256} is listed with two sizes`);
      if (!seen)
        objects.set(o.sha256, {
          sha256: o.sha256,
          bytes: o.bytes,
          role: role === 'inputs' ? 'input' : 'output',
        });
    }
  }
  need((m.outputs || []).length > 0, 'a release without outputs');
  return { problems, objects: [...objects.values()] };
}

/** the bytes under objects/sha256/<sha>, checked again (an object whose bytes do not hash to its key is a storage incident) */
export async function readObject(env, sha) {
  const obj = await env.OBJECTS.get(objectKey(sha));
  if (!obj) return null;
  const buf = await obj.arrayBuffer();
  if ((await sha256(buf)) !== sha) {
    await env.DB.prepare('INSERT INTO incidents (sha256, found, at) VALUES (?1, ?2, ?3)')
      .bind(sha, 'read', now())
      .run();
    throw new Error('storage incident: ' + sha);
  }
  return buf;
}

const manifests = new Map(); // release_id -> parsed manifest (immutable by its id)
export async function manifestOf(env, rid) {
  if (manifests.has(rid)) return manifests.get(rid);
  const buf = await readObject(env, rid);
  if (!buf) return null;
  const m = { bytes: buf, json: JSON.parse(new TextDecoder().decode(buf)) };
  manifests.set(rid, m);
  return m;
}

/** a release is public once it has been current (section 9.2): candidates that were never published are not */
export async function isPublic(env, rid) {
  return !!(await env.DB.prepare('SELECT 1 FROM journal WHERE release_id = ?1 LIMIT 1')
    .bind(rid)
    .first());
}

export async function current(env) {
  return primary(env)
    .prepare('SELECT release_id, revision, kind, at FROM pointer WHERE id = 1')
    .first();
}
