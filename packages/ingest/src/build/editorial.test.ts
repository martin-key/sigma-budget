import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, expectTypeOf, it } from 'vitest';
import {
  buildGlossary,
  buildRawGuide,
  restoreEditorial,
  loadEditorialRoutes,
  applyGuide,
  checkGuide,
} from './editorial.js';
import { compare } from '../parity/compare.js';
const base = resolve(import.meta.dirname, '../../test/fixtures/editorial');
const bytes = (name: string) => readFileSync(resolve(base, name));
const json = (name: string) => JSON.parse(bytes(name).toString('utf8'));
const routes = () => loadEditorialRoutes(json('inputs/routes.json'));
const snapshots = () => ({
  'guide.json': bytes('inputs/guide.json'),
  'glossary.json': bytes('inputs/glossary.json'),
});
it('matches the frozen Python oracle and the historical glossary transform', () => {
  const actual = restoreEditorial(snapshots(), routes());
  const differences = (['glossary', 'guide'] as const).flatMap((id) =>
    compare(json(`oracle/${id}.json`), JSON.parse(actual[`${id}.json`].toString()), {
      dataset: id,
      file: `${id}.json`,
    }),
  );
  differences.push(
    ...compare(
      json('legacy-glossary.json'),
      buildGlossary(json('inputs/glossary-source.json'), routes()),
      { dataset: 'glossary', file: 'legacy-glossary.json' },
    ),
  );
  differences.push(
    ...compare(json('guide-apply.json'), applyGuide(json('inputs/guide.json')), {
      dataset: 'guide',
      file: 'guide-apply.json',
    }),
  );
  differences.push(
    ...compare(
      json('synthetic-guide-oracle.json'),
      buildRawGuide(bytes('inputs/synthetic-guide.txt').toString(), routes()),
      { dataset: 'guide', file: 'synthetic-guide.json' },
    ),
  );
  differences.push(
    ...compare(
      json('synthetic-guide-crlf-oracle.json'),
      buildRawGuide(bytes('inputs/synthetic-guide-crlf.txt').toString('utf8'), routes()),
      { dataset: 'guide', file: 'synthetic-guide-crlf.json' },
    ),
  );
  differences.push(
    ...compare(json('guide-check.json'), checkGuide(json('inputs/guide.json'), routes()), {
      dataset: 'guide',
      file: 'guide-check.json',
    }),
  );
  const report = { outcome: differences.length ? 'fail' : 'pass', differences, unverified: [] };
  if (process.env.EDITORIAL_PARITY_REPORT) {
    mkdirSync(dirname(process.env.EDITORIAL_PARITY_REPORT), { recursive: true });
    writeFileSync(process.env.EDITORIAL_PARITY_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  expect(differences).toEqual([]);
  for (const name of ['glossary.json', 'guide.json'] as const)
    expect(Buffer.from(actual[name])).toEqual(bytes(`oracle/${name}`));
});
it('rejects an unresolved href in the build', () => {
  const rs = routes().filter((r) => r.key !== 'prihodi');
  expect(() => buildGlossary(json('inputs/glossary-source.json'), rs)).toThrow(/Unresolved/);
  expect(() => restoreEditorial(snapshots(), rs)).toThrow();
});
it('rejects a missing term field', () => {
  const src = json('inputs/glossary-source.json');
  delete src.terms[0].def;
  expect(() => buildGlossary(src, routes())).toThrow();
});
it('rejects a duplicate slug', () => {
  const src = json('inputs/glossary-source.json');
  src.terms[1].slug = src.terms[0].slug;
  expect(() => buildGlossary(src, routes())).toThrow();
});
it('rejects a changed input hash', () => {
  const inputs = snapshots();
  inputs['guide.json'] = Buffer.from(inputs['guide.json'].toString() + ' ');
  expect(() => restoreEditorial(inputs, routes())).toThrow(/hash mismatch/);
});

it('normalizes CRLF and lone CR as Python text-mode reading does', () => {
  const expected = json('synthetic-guide-crlf-oracle.json');
  const crlf = bytes('inputs/synthetic-guide-crlf.txt').toString('utf8');
  expect(crlf).toContain('\r\n');
  expect(buildRawGuide(crlf, routes())).toEqual(expected);
  expect(buildRawGuide(crlf.replace(/\r\n/g, '\r'), routes())).toEqual(expected);
  expect(buildRawGuide(crlf.replace(/\r\n/, '\n'), routes())).toEqual(expected);
});

it('exposes structured editorial inputs and results', () => {
  expectTypeOf<
    ReturnType<typeof buildRawGuide>['steps'][number]['screen']['href']
  >().toEqualTypeOf<string>();
  expectTypeOf<
    ReturnType<typeof buildGlossary>['terms'][number]['related'][number]['slug']
  >().toEqualTypeOf<string>();
  expectTypeOf<
    Parameters<typeof buildGlossary>[0]['terms'][number]['aliases'][number]['text']
  >().toEqualTypeOf<string>();
  if (false) {
    const guide = buildRawGuide('', routes());
    // @ts-expect-error A misspelled screen field must not typecheck.
    guide.steps[0]!.screeen.href;
    const source = {} as Parameters<typeof buildGlossary>[0];
    // @ts-expect-error A misspelled glossary source field must not typecheck.
    source.titlle;
  }
});
