import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Context } from './context.js';
import { guideGroup } from './guide.js';

const root = resolve(import.meta.dirname, '../../../..');
let temp: string;
let guide: any;
beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'published-guide-'));
  await mkdir(join(temp, 'data/release'), { recursive: true });
  guide = JSON.parse(await readFile(join(root, 'data/release/guide.json'), 'utf8'));
});
afterAll(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});
async function check(value: any) {
  await writeFile(join(temp, 'data/release/guide.json'), JSON.stringify(value));
  return guideGroup.run(new Context(root, '2026-11-14', 'data/release', temp));
}
it('checks the committed guide against the current route catalogue with a non-zero count', async () => {
  const result = await check(guide);
  expect(result.n).toBeGreaterThan(0);
  expect(result.problems).toEqual([]);
});
it('rejects a published guide link to a missing route', async () => {
  const broken = structuredClone(guide);
  broken.steps[0].screen.href = '#/missing-published-route';
  expect((await check(broken)).problems.join(' ')).toMatch(
    /screen does not match route|unresolved href/,
  );
});
it('rejects an incorrect next-step link in the published guide', async () => {
  const broken = structuredClone(guide);
  broken.steps[0].next.href = '#/missing-next-route';
  expect((await check(broken)).problems.join(' ')).toMatch(/next link does not name next step/);
});
