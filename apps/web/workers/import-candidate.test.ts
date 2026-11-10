import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyCandidate, readCandidate } from '../scripts/candidate-data';
import { releaseData, candidateReleaseId } from './release-data';
import { provideScope } from '../client/env.js';
import { requestState } from '../client/store.js';
import { renderScreen } from '../app/lib/screen.server';

const store = vi.hoisted(() => ({ current: vi.fn(async () => null) }));
vi.mock('./api/store.js', () => ({ ...store, manifestOf: vi.fn(), readObject: vi.fn() }));
const temporary: string[] = [];
const scratch = () => {
  const path = mkdtempSync(join(tmpdir(), 'budget-import-site-'));
  temporary.push(path);
  return path;
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function fixture(passed = true) {
  const root = scratch();
  mkdirSync(join(root, 'data'));
  const contents = {
    'data/core.json': { meta: { status: 'real' }, marker: 'candidate only' },
    'data/catalog.json': { datasets: [] },
    'validation.json': { passed, groups: [{ group: 'CONTRACT', status: passed ? 'OK' : 'FAIL' }] },
  };
  const outputs = Object.entries(contents).map(([path, value]) => {
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    writeFileSync(join(root, path), bytes);
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  });
  const manifest = Buffer.from(JSON.stringify({ manifest_schema: 'budget-release/1', outputs }));
  writeFileSync(join(root, 'manifest.json'), manifest);
  writeFileSync(join(root, 'receipt.json'), JSON.stringify({ release_id: hash(manifest) }));
  return root;
}

function assets(root: string, missing = '') {
  return {
    fetch: vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === missing) return new Response(null, { status: 404 });
      try {
        return new Response(readFileSync(join(root, path)), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  store.current.mockClear();
  provideScope(() => null);
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

it('packages a validated candidate with one release identity and no checkout write', async () => {
  const candidate = readCandidate(fixture());
  const target = join(scratch(), 'data');
  copyCandidate(candidate, target);
  expect(JSON.parse(readFileSync(join(target, 'releases/current.json'), 'utf8')).release_id).toBe(
    candidate.releaseId,
  );
  expect(readFileSync(join(target, 'releases', candidate.releaseId, 'manifest.json'))).toEqual(
    candidate.manifest,
  );
  vi.stubGlobal('__BUDGET_CANDIDATE_RELEASE__', candidate.releaseId);
  const env = { ASSETS: assets(join(target, '..')) } as unknown as Env;
  const selected = await releaseData(env, 'https://budget.test');
  expect(selected.releaseId).toBe(candidate.releaseId);
  expect(selected.dataBase).toBe('/data/');
  expect(await selected.load('core')).toMatchObject({ marker: 'candidate only' });
  expect(await selected.load('release/manifest')).toMatchObject({
    manifest_schema: 'budget-release/1',
  });
  expect(await selected.load('release/validation')).toMatchObject({ passed: true });
  expect(store.current).not.toHaveBeenCalled();
  await expect(selected.load('unavailable-programme')).rejects.toMatchObject({
    name: 'PendingError',
  });
});

it('fails clearly for missing bytes, changed bytes, unsuccessful validation and unlisted data', () => {
  const missing = fixture();
  rmSync(join(missing, 'data/core.json'));
  expect(() => readCandidate(missing)).toThrow('BUDGET_CANDIDATE:');
  const corrupt = fixture();
  writeFileSync(join(corrupt, 'data/core.json'), '{}');
  expect(() => readCandidate(corrupt)).toThrow('SHA-256 differ');
  expect(() => readCandidate(fixture(false))).toThrow('successful production validation');
  const unlisted = fixture();
  writeFileSync(join(unlisted, 'data/unlisted.json'), '{}');
  expect(() => readCandidate(unlisted)).toThrow('unlisted candidate data');
});

it('refuses a changed candidate at packaging time and a missing declared SSR asset', async () => {
  const root = fixture();
  const candidate = readCandidate(root);
  writeFileSync(join(root, 'data/core.json'), '{}');
  expect(() => copyCandidate(candidate, join(scratch(), 'data'))).toThrow('BUDGET_CANDIDATE:');
  const good = readCandidate(fixture());
  const target = join(scratch(), 'data');
  copyCandidate(good, target);
  vi.stubGlobal('__BUDGET_CANDIDATE_RELEASE__', good.releaseId);
  const env = { ASSETS: assets(join(target, '..'), '/data/core.json') } as unknown as Env;
  const selected = await releaseData(env, 'https://budget.test');
  await expect(selected.load('core')).rejects.toMatchObject({ name: 'LoadError' });
});

it('keeps the default bundled-release path when no candidate is selected', async () => {
  const root = scratch();
  mkdirSync(join(root, 'data/releases'), { recursive: true });
  writeFileSync(
    join(root, 'data/releases/current.json'),
    JSON.stringify({ release_id: 'd'.repeat(64) }),
  );
  writeFileSync(join(root, 'data/core.json'), JSON.stringify({ marker: 'default' }));
  expect(candidateReleaseId()).toBeNull();
  const selected = await releaseData(
    { ASSETS: assets(root) } as unknown as Env,
    'https://budget.test',
  );
  expect(selected.releaseId).toBe('d'.repeat(64));
  expect(await selected.load('core')).toEqual({ marker: 'default' });
  expect(store.current).toHaveBeenCalledOnce();
});

it.skipIf(!process.env.BUDGET_IMPORT_CANDIDATE)(
  'renders real SSR screens from the selected Python candidate',
  async () => {
    const candidate = readCandidate(process.env.BUDGET_IMPORT_CANDIDATE!);
    const target = join(scratch(), 'data');
    copyCandidate(candidate, target);
    vi.stubGlobal('__BUDGET_CANDIDATE_RELEASE__', candidate.releaseId);
    const selected = await releaseData(
      { ASSETS: assets(join(target, '..')) } as unknown as Env,
      'https://budget.test',
    );
    const outlook = (await selected.load('outlook')) as {
      byPeriod: Record<
        string,
        { publication: string; series: Record<string, { value: number; unit: string }> }
      >;
    };
    // Independent PDF-cell oracle: Annex 3, p191, 2027 draft, million EUR.
    expect(outlook.byPeriod['2027.draft'].series.revenue).toMatchObject({
      value: 51065.2,
      unit: 'млн. €',
    });
    expect(outlook.byPeriod['2027.draft'].publication).toBe('2026-11-06');
    for (const address of [
      '/byudzhet-2027?per=2027.draft',
      '/prihodi?per=2027.draft',
      '/prognoza?per=2029.forecast',
      '/vedomstva?per=2027.draft',
      '/prihodi?per=2026.law',
    ]) {
      const url = new URL(address, 'https://budget.test');
      provideScope(() => ({
        url,
        origin: url.origin,
        releaseId: selected.releaseId,
        dataBase: selected.dataBase,
        state: requestState(url.searchParams.get('per')),
        data: new Map(),
        load: selected.load,
      }));
      const result = await renderScreen(url, {
        id: selected.releaseId,
        dataBase: selected.dataBase,
        origin: url.origin,
        sigmaUrl: '',
        feedbackEmail: '',
      });
      expect('doc' in result, address).toBe(true);
      if ('doc' in result) {
        expect(result.doc.status, address).toBe(200);
        expect(result.doc.view, address).toContain('data-view="ready"');
        expect(result.doc.release.id).toBe(candidate.releaseId);
      }
    }
    expect(store.current).not.toHaveBeenCalled();
  },
);
