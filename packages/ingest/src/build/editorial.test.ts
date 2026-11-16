import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, expectTypeOf, it } from 'vitest';
import {
  buildGlossary,
  buildRawGuide,
  restoreEditorial,
  loadEditorialRoutes,
  checkGuide,
  alignGuideLinks,
} from './editorial.js';
const base = resolve(import.meta.dirname, '../../test/fixtures/editorial');
const bytes = (name: string) => readFileSync(resolve(base, name));
const json = (name: string) => JSON.parse(bytes(name).toString('utf8'));
const routes = () => loadEditorialRoutes(json('inputs/routes.json'));
const snapshots = () => ({
  'guide.json': bytes('inputs/guide.json'),
  'glossary.json': bytes('inputs/glossary.json'),
});
it('aligns navigation with injected routes after preserving the frozen snapshot', () => {
  const original = snapshots();
  const restored = restoreEditorial(original, routes());
  const guide = JSON.parse(Buffer.from(restored['guide.json']).toString('utf8'));
  const changed = routes();
  Object.assign(changed.find((r) => r.id === guide.steps[3].screen.id)!, {
    title: 'Проверено ново заглавие',
    pattern: '/provereni-merki',
  });
  const actual = alignGuideLinks(guide, changed);
  expect(checkGuide(actual, changed)).toEqual([]);
  expect(alignGuideLinks(actual, changed)).toEqual(actual);
  expect(Buffer.from(restored['guide.json'])).toEqual(bytes('inputs/guide.json'));
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
