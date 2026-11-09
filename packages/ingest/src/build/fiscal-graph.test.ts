import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { loadFiscalFixture } from './fiscal-fixture.js';
import { runFiscalGraph, type FiscalGraphInput } from './fiscal-graph.js';
import { runGraph, type GraphStage } from './graph.js';
import { validateProvenance } from './wave13a.js';
import { parsePythonJson } from '../common/numbers.js';

const root = resolve(import.meta.dirname, '../../test/fixtures');
const read = (name: string) => parsePythonJson<any>(readFileSync(resolve(root, name), 'utf8'));
async function input(): Promise<FiscalGraphInput> {
  const fiscal = await loadFiscalFixture(resolve(root, 'fiscal'));
  const archive = readFileSync(
    resolve(root, 'fiscal/inputs/data/originals/budget_2027/ZDBRB-2027.zip'),
  );
  return {
    fiscal,
    forecast: read('fiscal/inputs/data/inputs/budget_forecast_2027.json'),
    bill: read('fiscal/inputs/data/inputs/budget_bill_2027.json'),
    archives: { forecast: archive, bill: archive },
    law: read('wave13b/legal-evidence.json'),
    buildDate: '2026-11-08',
  };
}

let source: FiscalGraphInput;
let original: ReturnType<typeof runFiscalGraph>;
beforeAll(async () => {
  source = await input();
  original = runFiscalGraph(source);
});

it('builds the annual chain from fresh fiscal outputs and one lineage', () => {
  const result = original;
  expect(result.states.filter((state) => state.status !== 'success')).toEqual([]);
  const annual = result.outputs.get('annual-periods') as any;
  const budget = result.outputs.get('budget-2027') as any;
  const outputs = {
    'outlook.json': annual.outlook,
    'revenue.json': annual.revenue,
    'expenditure.json': annual.expenditure,
    'budget2027.json': budget.budget,
    'budget2027-provenance.json': budget.provenance,
    'law.json': {},
  } as Parameters<typeof validateProvenance>[0];
  validateProvenance(outputs, annual.lineage);
  for (const [name, value] of Object.entries(outputs).filter(([name]) => name !== 'law.json'))
    expect(value).toEqual(read(`wave13a/final/${name}`));
  expect(result.outputs.get('measures')).toEqual(read('fiscal/donor/measures.json'));
});

it('propagates a changed upstream fiscal value into the annual owner', () => {
  source.fiscal.differingRows[0]!.docx[0]! += 1;
  const changed = runFiscalGraph(source);
  expect(changed.states.filter((state) => state.status !== 'success')).toEqual([]);
  expect(changed.outputs.get('outlook')).not.toEqual(original.outputs.get('outlook'));
  expect((changed.outputs.get('annual-periods') as any).outlook).not.toEqual(
    (original.outputs.get('annual-periods') as any).outlook,
  );
});

it('validates the graph before execution and records failures, skips and optional reads', () => {
  let calls = 0;
  const stage = (id: string, requires: string[] = []): GraphStage => ({
    id,
    requires,
    run: () => ++calls,
  });
  expect(() => runGraph([stage('a', ['missing'])])).toThrow(/Missing stage/);
  expect(() => runGraph([stage('a', ['b']), stage('b', ['a'])])).toThrow(/Cycle/);
  expect(calls).toBe(0);
  const result = runGraph([
    {
      id: 'failed',
      requires: [],
      run: () => {
        throw new Error('broken');
      },
    },
    stage('dependent', ['failed']),
    {
      id: 'optional',
      requires: [],
      optional: ['failed'],
      run: (read) => read('failed') ?? 'absent',
    },
    stage('independent'),
    { id: 'illegal', requires: [], run: (read) => read('independent') },
  ]);
  expect(result.states).toEqual([
    { id: 'failed', status: 'failed', error: 'broken' },
    { id: 'dependent', status: 'skipped', blockedBy: ['failed'] },
    { id: 'optional', status: 'success' },
    { id: 'independent', status: 'success' },
    { id: 'illegal', status: 'failed', error: 'Undeclared dependency independent for illegal' },
  ]);
  expect(result.outputs.get('optional')).toBe('absent');
  expect(result.outputs.has('dependent')).toBe(false);
});

it('orders stages by declared dependencies rather than declaration order', () => {
  const result = runGraph([
    { id: 'last', requires: ['first'], run: (read) => (read('first') as number) + 1 },
    { id: 'first', requires: [], run: () => 3 },
  ]);
  expect(result.states.map((state) => state.id)).toEqual(['first', 'last']);
  expect(result.outputs.get('last')).toBe(4);
});
