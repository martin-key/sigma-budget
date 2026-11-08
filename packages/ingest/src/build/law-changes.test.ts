import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { articleOne, budgetRows } from './law-articles.js';
import { lawChanges } from './law-changes.js';
const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../test/fixtures/law', name), 'utf8'));
it('matches the Python change details, notes and reconciliation', () => {
  const e = fixture('evidence.json'),
    o = fixture('oracle.json');
  expect(lawChanges(e.law, budgetRows(e.law, e.ministries), articleOne(e.law))).toEqual({
    changes: o.changes,
    reconciliation: o.reconciliation,
  });
});
