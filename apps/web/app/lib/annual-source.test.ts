import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { annualSourceText } from '../../client/ui/annual-source.js';
it('limits the project/law warning to historical project figures', () => {
  for (const vintage of ['plan', 'draft', 'forecast']) {
    expect(
      annualSourceText({
        available: true,
        legacy: true,
        vintage,
        year: 2026,
        sourceRefs: ['asbp'],
      }),
    ).toContain('Приетият закон може да се различава от проекта');
  }
  expect(annualSourceText({ available: false })).toBe('');
});
it('uses the record publication date rather than a fixed acquisition date', () => {
  expect(
    annualSourceText({
      available: true,
      year: 2026,
      status: 'expected',
      sourceRefs: ['budget2027'],
      publication: '2026-11-07',
    }),
  ).toContain('07.11.2026');
});

it('resolves section locations from the release cell IDs and checks period and source', () => {
  const load = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../../../../data/release/${name}.json`, import.meta.url), 'utf8'),
    );
  const expenditure = load('expenditure');
  const provenance = load('budget2027-provenance');
  for (const record of Object.values(expenditure.byPeriod) as any[]) {
    const p = { ...record, available: true };
    const sections = p.status === 'law' ? ['rows'] : ['functions', 'rows'];
    const text = annualSourceText(p, { provenance, sections });
    for (const section of sections) {
      for (const row of p[section]) {
        const entry = provenance.entries[row.cell.provenance];
        expect(entry.period).toBe(p.periodKey);
        expect(p.sourceRefs).toContain(provenance.documents[entry.document].source);
        expect(entry.output).toContain(`/byPeriod/${p.periodKey}/${section}/`);
        expect(text).toContain(`стр. ${entry.page}`);
      }
    }
  }
  const p = { ...expenditure.byPeriod['2026.expected'], available: true };
  const row = p.functions.find((r: any) => r.label === 'Образование');
  const entry = provenance.entries[row.cell.provenance];
  entry.page = 321;
  entry.table = 'annex1_execution2026';
  const options = { provenance, sections: ['functions'], functionLabel: row.label };
  expect(annualSourceText(p, options)).toContain('Приложение 1, стр. 321');
  expect(annualSourceText(p, options)).not.toContain('Табл. III-1');
  entry.period = '2027.draft';
  expect(annualSourceText(p, options)).not.toContain('321');
  entry.period = p.periodKey;
  provenance.documents[entry.document].source = 'another-source';
  expect(annualSourceText(p, options)).not.toContain('321');
});
