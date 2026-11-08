import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { transformState, type StateLaw } from './components.js';
import {
  transformMunicipal,
  transformNational,
  transformOther,
  type ComponentEvidenceTables,
} from './components-tables.js';
const root = resolve(import.meta.dirname, '../../test/fixtures/components-rates');
const read = (n: string): unknown => JSON.parse(readFileSync(resolve(root, n), 'utf8'));
const evidence = (): ComponentEvidenceTables => ({
  tables: read('inputs/tables.json') as ComponentEvidenceTables['tables'],
  municipalities: read('inputs/municipalities.json') as ComponentEvidenceTables['municipalities'],
  outlook: read('inputs/outlook.json') as ComponentEvidenceTables['outlook'],
  execution: read('inputs/execution.json') as ComponentEvidenceTables['execution'],
  pages: read('inputs/pages.json') as ComponentEvidenceTables['pages'],
});
it('matches independent Python table transformations', () => {
  const e = evidence();
  expect({
    municipal: transformMunicipal(
      e,
      transformState(read('inputs/law.json') as StateLaw).transfers.municipalities,
    ),
    national: transformNational(e),
    other: transformOther(e),
  }).toEqual(read('component-tables.json'));
});
it('rejects a damaged municipal source total', () => {
  const e = evidence();
  e.municipalities.totals.transfersKhil++;
  expect(() => transformMunicipal(e, e.municipalities.totals.allKhil)).toThrow(/main transfers/);
});
it('rejects a changed national forecast source', () => {
  const e = evidence();
  e.outlook.kfp.revenue.mln[2]!++;
  expect(() => transformNational(e)).toThrow(/national \+ EU/);
});
