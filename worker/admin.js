// The operator API (docs/approach-specification.md, sections 7.1, 7.2 and 8.2). Every route needs an operator of this environment (access.js).
//   POST /admin/operations                        body: the exact bytes of manifest.json -> operation_id, release_id and the objects the
//                                                  server still needs (the manifest itself is stored and checked at once)
//   PUT  /admin/operations/:op/objects/:sha256     the bytes of one object listed in the manifest; the server reads them back from R2 and
//                                                  checks the size and SHA-256 before the object gets its content-addressed key
//   POST /admin/operations/:op/seal                every object verified -> the candidate is registered and the operation is closed
//   GET  /admin/operations/:op                     the state of an operation, to resume an upload
//   POST /admin/publish                            {release_id, expected_revision, request_id, kind: publish|rollback} -> one guarded
//                                                  UPDATE of the pointer; the trigger writes the journal in the same transaction
//   GET  /admin/requests/:request_id               the result of a publish whose response was lost
// Errors: 400 bad request, 401/403 auth, 404 unknown, 409 revision conflict or not allowed now, 413 too large, 422 data that fail a check,
// 429 too many open operations, 500 storage incident. No route overwrites or deletes a published object or a journal row.
import { operator } from './access.js';
import { HEX64, SUPPORTED, checkManifest, current, json, maxBytes, now, objectKey, primary, sha256, uploadKey } from './store.js';

const MANIFEST_LIMIT = 4 * 1024 * 1024;
const OPEN_LIMIT = 20;                                       // open operations per operator (section 10.2: limits of size and rate)
const REQUEST_ID = /^[A-Za-z0-9-]{16,64}$/;

/** verify the bytes under uploads/<op>/<sha>, then give them their final key; an existing final object is reused only if it hashes to it */
async function promote(env, op, sha, bytes) {
  const tmp = await env.OBJECTS.get(uploadKey(op, sha));
  if (!tmp) return { ok: false, status: 409, error: 'nothing uploaded for ' + sha };
  const buf = await tmp.arrayBuffer();
  if (buf.byteLength !== bytes || (await sha256(buf)) !== sha) {
    await env.OBJECTS.delete(uploadKey(op, sha));            // a wrong upload cannot reserve the key or block the next attempt
    return { ok: false, status: 422, error: `the bytes do not match: ${buf.byteLength} bytes, sha256 ${await sha256(buf)}` };
  }
  const final = await env.OBJECTS.get(objectKey(sha));
  if (final) {
    const fb = await final.arrayBuffer();
    if ((await sha256(fb)) !== sha) {
      await env.DB.prepare('INSERT INTO incidents (sha256, found, operation_id, at) VALUES (?1, ?2, ?3, ?4)').bind(sha, 'promote', op, now()).run();
      return { ok: false, status: 500, error: 'storage incident: the object under ' + sha + ' does not hash to it' };
    }
  } else {
    await env.OBJECTS.put(objectKey(sha), buf, { sha256: sha, customMetadata: { sha256: sha } });     // R2 checks the sha256 on write
    const back = await env.OBJECTS.get(objectKey(sha));
    if (!back || (await sha256(await back.arrayBuffer())) !== sha) return { ok: false, status: 500, error: 'the stored object does not read back' };
  }
  await env.OBJECTS.delete(uploadKey(op, sha));
  await env.DB.prepare('UPDATE operation_objects SET verified = 1 WHERE operation_id = ?1 AND sha256 = ?2').bind(op, sha).run();
  return { ok: true };
}

async function objectsOf(env, op) {
  return (await env.DB.prepare('SELECT sha256, bytes, role, verified FROM operation_objects WHERE operation_id = ?1 ORDER BY sha256').bind(op).all()).results;
}

async function startOperation(request, env, who) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MANIFEST_LIMIT) return json({ error: 'the manifest is larger than ' + MANIFEST_LIMIT }, 413);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MANIFEST_LIMIT) return json({ error: 'the manifest is larger than ' + MANIFEST_LIMIT }, 413);
  let m;
  try { m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf)); } catch { return json({ error: 'the manifest is not UTF-8 JSON' }, 400); }
  const { problems, objects } = checkManifest(m, env);
  if (problems.length) return json({ error: 'the manifest fails the checks', problems }, 422);
  const open = await env.DB.prepare("SELECT count(*) AS n FROM operations WHERE operator = ?1 AND state = 'open'").bind(who).first();
  if (open.n >= OPEN_LIMIT) return json({ error: 'too many open operations; seal or abandon one' }, 429);
  const rid = await sha256(buf);
  const op = crypto.randomUUID();
  const stmts = [env.DB.prepare("INSERT INTO operations (operation_id, release_id, state, operator, created_at) VALUES (?1, ?2, 'open', ?3, ?4)").bind(op, rid, who, now()),
    env.DB.prepare("INSERT INTO operation_objects (operation_id, sha256, bytes, role) VALUES (?1, ?2, ?3, 'manifest')").bind(op, rid, buf.byteLength)];
  for (const o of objects.filter(o => o.sha256 !== rid)) {
    stmts.push(env.DB.prepare('INSERT INTO operation_objects (operation_id, sha256, bytes, role) VALUES (?1, ?2, ?3, ?4)').bind(op, o.sha256, o.bytes, o.role));
  }
  await env.DB.batch(stmts);
  await env.OBJECTS.put(uploadKey(op, rid), buf);
  const p = await promote(env, op, rid, buf.byteLength);
  if (!p.ok) return json({ error: p.error }, p.status);
  // objects that are already stored and hash to their key need no upload: mark them, so a resumed or a second release skips them
  for (const o of objects) {
    const have = await env.OBJECTS.head(objectKey(o.sha256));
    if (have && have.size === o.bytes) {
      await env.OBJECTS.put(uploadKey(op, o.sha256), await (await env.OBJECTS.get(objectKey(o.sha256))).arrayBuffer());
      const q = await promote(env, op, o.sha256, o.bytes);
      if (!q.ok) return json({ error: q.error }, q.status);
    }
  }
  const objs = await objectsOf(env, op);
  return json({ operation_id: op, release_id: rid, objects: objs.length, needed: objs.filter(o => !o.verified).map(o => ({ sha256: o.sha256, bytes: o.bytes, role: o.role })) }, 201);
}

async function putObject(request, env, op, sha, who) {
  const row = await env.DB.prepare('SELECT o.state, o.operator, x.bytes, x.verified FROM operations o JOIN operation_objects x ON x.operation_id = o.operation_id WHERE o.operation_id = ?1 AND x.sha256 = ?2')
    .bind(op, sha).first();
  if (!row) return json({ error: 'the operation does not list ' + sha }, 404);
  if (row.operator !== who) return json({ error: 'another operator started this operation' }, 403);
  if (row.state !== 'open') return json({ error: 'the operation is sealed: a change needs a new candidate' }, 409);
  if (row.verified) return json({ sha256: sha, verified: true, already: true });
  const len = Number(request.headers.get('Content-Length') || -1);
  if (len > maxBytes(env)) return json({ error: 'larger than the limit of ' + maxBytes(env) }, 413);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes(env)) return json({ error: 'larger than the limit of ' + maxBytes(env) }, 413);
  await env.OBJECTS.put(uploadKey(op, sha), buf);
  const p = await promote(env, op, sha, row.bytes);
  return p.ok ? json({ sha256: sha, verified: true }) : json({ error: p.error }, p.status);
}

async function seal(env, op, who) {
  const o = await env.DB.prepare('SELECT release_id, state, operator FROM operations WHERE operation_id = ?1').bind(op).first();
  if (!o) return json({ error: 'no such operation' }, 404);
  if (o.operator !== who) return json({ error: 'another operator started this operation' }, 403);
  const objs = await objectsOf(env, op);
  const missing = objs.filter(x => !x.verified);
  if (missing.length) return json({ error: `${missing.length} objects are not uploaded and verified`, needed: missing.map(x => x.sha256) }, 409);
  const known = await env.DB.prepare('SELECT release_id, state FROM releases WHERE release_id = ?1').bind(o.release_id).first();
  if (o.state === 'sealed' || known) {
    if (o.state !== 'sealed') await env.DB.prepare("UPDATE operations SET state = 'sealed' WHERE operation_id = ?1").bind(op).run();
    return json({ release_id: o.release_id, state: known ? known.state : 'validated', already: true });
  }
  // the structural checks once more, on the stored manifest (the server does not repeat the Python processing: section 7.2, step 4)
  const m = JSON.parse(new TextDecoder().decode(await (await env.OBJECTS.get(objectKey(o.release_id))).arrayBuffer()));
  const { problems } = checkManifest(m, env);
  const state = problems.length ? 'candidate' : 'validated';
  const bytes = objs.reduce((s, x) => s + x.bytes, 0);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO releases (release_id, data_schema, state, objects, bytes, checks, operation_id, sealed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(o.release_id, JSON.stringify(m.data_schema), state, objs.length, bytes, JSON.stringify({ problems, supported: SUPPORTED }), op, now()),
    env.DB.prepare("UPDATE operations SET state = 'sealed' WHERE operation_id = ?1").bind(op),
  ]);
  return json({ release_id: o.release_id, state, objects: objs.length, bytes, problems }, problems.length ? 422 : 200);
}

const resultOf = row => ({ release_id: row.release_id, previous_release_id: row.previous_release_id, revision: row.revision, kind: row.kind,
  request_id: row.request_id, at: row.at });

async function publish(request, env, who) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'the body is not JSON' }, 400); }
  const kind = b.kind || 'publish';
  if (!HEX64.test(b.release_id || '') || !Number.isInteger(b.expected_revision) || !REQUEST_ID.test(b.request_id || '') || !['publish', 'rollback'].includes(kind)) {
    return json({ error: 'publish needs release_id, expected_revision (integer), request_id (16-64 of A-Z a-z 0-9 -) and kind publish|rollback' }, 400);
  }
  const payload = await sha256(`${kind}\n${b.release_id}\n${b.expected_revision}`);
  const db = primary(env);
  const before = await db.prepare('SELECT * FROM journal WHERE request_id = ?1').bind(b.request_id).first();
  if (before) {
    return before.payload_sha256 === payload ? json({ ...resultOf(before), replay: true })
      : json({ error: 'this request_id was used for another publish' }, 422);
  }
  const rel = await db.prepare('SELECT state, data_schema FROM releases WHERE release_id = ?1').bind(b.release_id).first();
  if (!rel) return json({ error: 'no such candidate: upload and seal it first' }, 404);
  if (rel.state !== 'validated') return json({ error: 'the candidate failed the structural checks' }, 422);
  const ds = JSON.parse(rel.data_schema);
  for (const [k, ok] of Object.entries(SUPPORTED)) {
    if (ds[k] !== undefined && !ok.includes(ds[k])) return json({ error: `this code does not read ${k} ${ds[k]}` }, 409);
  }
  if (kind === 'rollback' && !(await db.prepare('SELECT 1 FROM journal WHERE release_id = ?1 LIMIT 1').bind(b.release_id).first())) {
    return json({ error: 'a rollback goes to a release that has been current before' }, 409);
  }
  const cur = await current(env);
  if (cur.release_id === b.release_id) return json({ error: 'this release is already current', release_id: cur.release_id, revision: cur.revision }, 409);
  const at = now();
  const res = await db.prepare(`UPDATE pointer SET release_id = ?1, revision = revision + 1, kind = ?2, request_id = ?3, payload_sha256 = ?4, operator = ?5, at = ?6
    WHERE id = 1 AND revision = ?7 AND EXISTS (SELECT 1 FROM releases WHERE release_id = ?1 AND state = 'validated')
      AND NOT EXISTS (SELECT 1 FROM journal WHERE request_id = ?3)`)
    .bind(b.release_id, kind, b.request_id, payload, who, at, b.expected_revision).run().catch(e => ({ error: e }));
  if (res.error) {
    const again = await db.prepare('SELECT * FROM journal WHERE request_id = ?1').bind(b.request_id).first();   // a concurrent same request
    if (again) return again.payload_sha256 === payload ? json({ ...resultOf(again), replay: true }) : json({ error: 'this request_id was used for another publish' }, 422);
    return json({ error: 'the registry refused the change' }, 409);
  }
  // the journal decides, not meta.changes (it counts the row of the trigger too): the event of this request_id exists now and did not
  // before, so this request applied it, or an identical request did at the same moment, which has the same result
  const done = await db.prepare('SELECT * FROM journal WHERE request_id = ?1').bind(b.request_id).first();
  if (done) return done.payload_sha256 === payload ? json(resultOf(done)) : json({ error: 'this request_id was used for another publish' }, 422);
  // nothing changed: another publish moved the revision first. A zero is never taken as success.
  const now_ = await current(env);
  return json({ error: 'revision conflict: the current release changed', current_release_id: now_.release_id, revision: now_.revision,
    expected_revision: b.expected_revision }, 409);
}

export async function adminApi(request, env, url) {
  if (!env.DB || !env.OBJECTS) return json({ error: 'this environment has no release registry yet' }, 503);
  const who = await operator(request, env);
  if (!who.ok) return json({ error: who.error }, who.status);
  const parts = url.pathname.split('/').filter(Boolean);                     // admin, ...
  const m = request.method;
  if (m === 'POST' && parts[1] === 'operations' && parts.length === 2) return startOperation(request, env, who.operator);
  if (parts[1] === 'operations' && parts.length >= 3) {
    const op = parts[2];
    if (!/^[0-9a-f-]{36}$/.test(op)) return json({ error: 'no such operation' }, 404);
    if (m === 'GET' && parts.length === 3) {
      const o = await env.DB.prepare('SELECT operation_id, release_id, state, created_at FROM operations WHERE operation_id = ?1').bind(op).first();
      if (!o) return json({ error: 'no such operation' }, 404);
      const objs = await objectsOf(env, op);
      return json({ ...o, objects: objs.length, needed: objs.filter(x => !x.verified).map(x => ({ sha256: x.sha256, bytes: x.bytes, role: x.role })) });
    }
    if (m === 'PUT' && parts[3] === 'objects' && HEX64.test(parts[4] || '') && parts.length === 5) return putObject(request, env, op, parts[4], who.operator);
    if (m === 'POST' && parts[3] === 'seal' && parts.length === 4) return seal(env, op, who.operator);
  }
  if (m === 'POST' && parts[1] === 'publish' && parts.length === 2) return publish(request, env, who.operator);
  if (m === 'GET' && parts[1] === 'requests' && parts.length === 3) {
    const row = await primary(env).prepare('SELECT * FROM journal WHERE request_id = ?1').bind(parts[2]).first();
    return row ? json(resultOf(row)) : json({ request_id: parts[2], applied: false }, 404);
  }
  return json({ error: 'no such operator route' }, 404);
}
