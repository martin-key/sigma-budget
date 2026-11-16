import { expect, it } from 'vitest';
import { FORMATS } from './formats';
import { catalog, load } from './data';
import { resolve } from './slice';
import { diskCtx } from './disk-release';

it('describes only sets of the catalog, and every example path is in the published file', async () => {
  const ctx = diskCtx();
  const cat = await catalog(ctx);
  for (const [slug, format] of Object.entries(FORMATS)) {
    const set = cat.datasets.find((s) => s.slug === slug);
    expect(set, slug).toBeDefined();
    expect(format.read.length, slug).toBeGreaterThan(0);
    for (const ex of format.examples) {
      const file = ex.part ? set!.parts!.find((p) => p.code === ex.part)!.file : String(set!.file);
      const value = resolve(
        await load(ctx, file.replace(/^data\//, '').replace(/\.json$/, '')),
        ex.path,
      );
      expect(value, `${slug} ${ex.path}`).not.toBeUndefined();
    }
  }
});

it('names the unit the file itself has', async () => {
  const ctx = diskCtx();
  for (const slug of ['ministries', 'execution']) {
    const { unit } = ((await load(ctx, slug)) as { meta: { unit: string } }).meta;
    expect(FORMATS[slug]!.read.join(' '), slug).toContain(unit);
  }
});
