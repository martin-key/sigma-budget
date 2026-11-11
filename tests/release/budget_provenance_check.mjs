// Regression against API responses captured before document metadata was deduplicated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { publicApi } from '../../apps/web/workers/api/api.js';
import { sha256 } from '../../apps/web/workers/api/store.js';

const root = process.env.BUDGET_PROVENANCE_TEST_ROOT
  ? pathToFileURL(process.env.BUDGET_PROVENANCE_TEST_ROOT + '/')
  : new URL('../../data/release/', import.meta.url);
const pointer = JSON.parse(fs.readFileSync(new URL('releases/current.json', root)));
const manifest = JSON.parse(
  fs.readFileSync(new URL(`releases/${pointer.release_id}/manifest.json`, root)),
);
const objects = new Map();
for (const output of manifest.outputs) {
  if (output.path.startsWith('data/'))
    objects.set(output.sha256, fs.readFileSync(new URL(output.path.slice(5), root)));
}
const reads = new Map();
let failOnce = null;
const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ public: 1 }) }) }) },
  OBJECTS: {
    get: async (key) => {
      const hash = key.split('/').at(-1);
      reads.set(hash, (reads.get(hash) || 0) + 1);
      if (hash === failOnce) {
        failOnce = null;
        return null;
      }
      const bytes = objects.get(hash);
      return bytes
        ? {
            arrayBuffer: async () =>
              bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          }
        : null;
    },
  },
};
async function request(candidate, id) {
  const bytes = Buffer.from(JSON.stringify(candidate));
  const rid = await sha256(bytes);
  objects.set(rid, bytes);
  const url = new URL(`https://example.test/api/releases/${rid}/provenance/budget2027/${id}`);
  const response = await publicApi(new Request(url), env, url);
  const body = JSON.parse(JSON.stringify(await response.json()).replaceAll(rid, 'RELEASE_ID'));
  return { status: response.status, body };
}
const fixtures = JSON.parse(
  fs.readFileSync(new URL('../pipeline/fixtures/budget_2027_api_responses.json', import.meta.url)),
);
let checks = 0;
for (const fixture of fixtures) {
  const response = await request(manifest, fixture.id);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, fixture.expected);
  checks += 2;
}
const printed = fixtures[0].id;
for (const mutation of ['output', 'original', 'index']) {
  const candidate = structuredClone(manifest);
  if (mutation === 'original') candidate.inputs = [];
  else
    candidate.outputs = candidate.outputs.filter((output) =>
      mutation === 'index'
        ? output.dataset !== 'budget2027-provenance'
        : output.path !== 'data/outlook.json',
    );
  assert.equal((await request(candidate, printed)).status, 404);
  checks++;
}
assert.equal((await request(manifest, 'unknown')).status, 404);
checks++;
const indexOutput = manifest.outputs.find((output) => output.dataset === 'budget2027-provenance');
for (const mutation of ['missing-document', 'unknown-reference']) {
  const index = JSON.parse(objects.get(indexOutput.sha256));
  const entry = index.entries[printed];
  if (mutation === 'missing-document') delete index.documents[entry.document];
  else entry.document = 'unknown';
  const bytes = Buffer.from(JSON.stringify(index));
  const hash = await sha256(bytes);
  objects.set(hash, bytes);
  const candidate = structuredClone(manifest);
  const output = candidate.outputs.find((output) => output.dataset === 'budget2027-provenance');
  output.sha256 = hash;
  output.bytes = bytes.length;
  assert.equal((await request(candidate, printed)).status, 404);
  checks++;
}
console.log(`PASS ${checks} provenance API checks`);

// The law primary balance must not escape membership validation just because its response omits document fields.
const derived = 'dc6a19ed2e010e62794cbe47';
assert.ok(JSON.parse(objects.get(indexOutput.sha256)).entries[derived].operands.length);
const missingInputs = structuredClone(manifest);
missingInputs.inputs = [];
assert.equal((await request(missingInputs, derived)).status, 404);
checks++;

// Every operand document is required, even when the root uses another document.
for (const mutation of ['foreign-operand-document', 'missing-operand', 'cyclic-operand']) {
  const index = JSON.parse(objects.get(indexOutput.sha256));
  const operand = index.entries[derived].operands[0];
  if (mutation === 'foreign-operand-document') {
    index.documents.bill.archive = 'data/originals/foreign.zip';
    index.documents.bill.archiveSha256 = 'f'.repeat(64);
    index.entries[operand].document = 'bill';
  } else if (mutation === 'missing-operand') delete index.entries[operand];
  else index.entries[derived].operands = [derived];
  const bytes = Buffer.from(JSON.stringify(index));
  const hash = await sha256(bytes);
  objects.set(hash, bytes);
  const candidate = structuredClone(manifest);
  const output = candidate.outputs.find((output) => output.dataset === 'budget2027-provenance');
  output.sha256 = hash;
  output.bytes = bytes.length;
  assert.equal((await request(candidate, derived)).status, 404);
  checks++;
}
console.log(
  `PASS ${checks} provenance membership/response checks; derived ${derived} without inputs returns 404`,
);

const datasetOutput = manifest.outputs.find((output) => output.path === 'data/outlook.json');
await request(manifest, printed);
const beforeHit = [reads.get(indexOutput.sha256), reads.get(datasetOutput.sha256)];
await request(manifest, printed);
assert.deepEqual([reads.get(indexOutput.sha256), reads.get(datasetOutput.sha256)], beforeHit);
checks++;
for (let i = 0; i < 4; i++) {
  const index = JSON.parse(objects.get(indexOutput.sha256));
  index.testCacheVersion = i;
  const bytes = Buffer.from(JSON.stringify(index));
  const hash = await sha256(bytes);
  objects.set(hash, bytes);
  const candidate = structuredClone(manifest);
  Object.assign(
    candidate.outputs.find((output) => output.dataset === 'budget2027-provenance'),
    { sha256: hash, bytes: bytes.length },
  );
  assert.equal((await request(candidate, printed)).status, 200);
}
await request(manifest, printed);
assert.ok(
  reads.get(indexOutput.sha256) > beforeHit[0],
  'the bounded cache must evict old index objects',
);
checks++;
const retryIndex = JSON.parse(objects.get(indexOutput.sha256));
retryIndex.testCacheVersion = 'retry';
const retryBytes = Buffer.from(JSON.stringify(retryIndex));
const retryHash = await sha256(retryBytes);
objects.set(retryHash, retryBytes);
const retryManifest = structuredClone(manifest);
Object.assign(
  retryManifest.outputs.find((output) => output.dataset === 'budget2027-provenance'),
  { sha256: retryHash, bytes: retryBytes.length },
);
failOnce = retryHash;
await assert.rejects(request(retryManifest, printed), /JSON object missing/);
assert.equal((await request(retryManifest, printed)).status, 200);
checks++;
console.log(`PASS ${checks} provenance checks including bounded cache hits, eviction and retry`);

const concurrentIndex = JSON.parse(objects.get(indexOutput.sha256));
concurrentIndex.testCacheVersion = 'concurrent';
const concurrentBytes = Buffer.from(JSON.stringify(concurrentIndex));
const concurrentHash = await sha256(concurrentBytes);
objects.set(concurrentHash, concurrentBytes);
const concurrentManifest = structuredClone(manifest);
Object.assign(
  concurrentManifest.outputs.find((output) => output.dataset === 'budget2027-provenance'),
  { sha256: concurrentHash, bytes: concurrentBytes.length },
);
const responses = await Promise.all(
  Array.from({ length: 3 }, () => request(concurrentManifest, printed)),
);
assert.ok(responses.every((response) => response.status === 200));
assert.equal(reads.get(concurrentHash), 1, 'concurrent requests must share one verified JSON read');
console.log(`PASS ${checks + 1} provenance checks including concurrent read coalescing`);
