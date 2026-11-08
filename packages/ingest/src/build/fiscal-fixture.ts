import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, join } from 'node:path';
import { readPinned } from '../io/data.js';
import { loadAnnex, type AnnexTables } from './annex.js';
import type { FiscalBuildInput } from './fiscal-build.js';
import type { CleanPage, FiscalTable, FiscalVersion } from './fiscal.js';
import type { CofogInput, FunctionInput, PopulationInput } from './fiscal-expenditure.js';
import type { MeasureSource, MeasureExcerpts } from './measures.js';
import type { AnnualForecast } from './fiscal-annual.js';
interface Provenance {
  frozenInputSha256: Record<string, string>;
  oracleSha256: Record<string, string>;
  publishedSnapshotSha256: Record<string, string>;
  policySha256: string;
}
function child(root: string, name: string): string {
  const target = resolve(root, name),
    rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw new Error(`Invalid fixture path ${name}`);
  return target;
}
export async function verifyFiscalInputs(root: string): Promise<void> {
  root = resolve(root);
  if ((await realpath(root)) !== root) throw new Error('Symlink in fiscal fixture root');
  const checked = async (name: string): Promise<string> => {
    const target = child(root, name);
    let current = root;
    for (const part of relative(root, target).split(sep)) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink in fiscal fixture');
    }
    return target;
  };
  const manifest = JSON.parse(
    await readFile(await checked('datasets-provenance.json'), 'utf8'),
  ) as Provenance;
  const inputNames = [
    'data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json',
    'data/inputs/budget_bill_2027.json',
    'data/inputs/budget_forecast_2027.json',
    'data/inputs/cofog_bg.json',
    'data/inputs/kfp_functions_2026.json',
    'data/inputs/measure_excerpts.json',
    'data/inputs/measures_2026.json',
    'data/inputs/population.json',
    'data/originals/asbp/asbp_tables.json',
    'data/originals/budget_2027/ZDBRB-2027.zip',
    'datasets.yaml',
    'dv-blocks.json',
  ];
  const names = ['outlook.json', 'revenue.json', 'expenditure.json', 'measures.json'];
  const outputs = [
    ...names.map((n) => `donor/${n}`),
    ...names.map((n) => `oracle/${n}`),
    'debt-text-oracle.json',
  ];
  const exactly = (actual: string[], expected: string[]) =>
    actual.sort().join('\n') === expected.sort().join('\n');
  if (
    !exactly(Object.keys(manifest.frozenInputSha256), inputNames) ||
    !exactly(Object.keys(manifest.oracleSha256), outputs) ||
    !exactly(Object.keys(manifest.publishedSnapshotSha256), names)
  )
    throw new Error('Incomplete fiscal fixture inventory');
  await readPinned(await checked('policy.json'), manifest.policySha256);
  for (const [name, hash] of Object.entries(manifest.frozenInputSha256))
    await readPinned(await checked(`inputs/${name}`), hash);
  for (const [name, hash] of Object.entries(manifest.oracleSha256))
    await readPinned(await checked(name), hash);
  for (const [name, hash] of Object.entries(manifest.publishedSnapshotSha256))
    await readPinned(await checked(`published/${name}`), hash);
}
export async function loadFiscalFixture(root: string): Promise<FiscalBuildInput> {
  await verifyFiscalInputs(root);
  const read = async <T>(name: string): Promise<T> =>
    JSON.parse(await readFile(child(resolve(root), `inputs/data/${name}`), 'utf8')) as T;
  const source = await read<{
    tables: AnnexTables & Record<string, FiscalTable>;
    docx_check: { differing_rows: FiscalVersion[] };
  }>('originals/asbp/asbp_tables.json');
  const [pages, functions, cofog, population, measures, excerpts, forecast] = await Promise.all([
    read<CleanPage[]>('cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json'),
    read<{ functions: FunctionInput[] }>('inputs/kfp_functions_2026.json'),
    read<CofogInput>('inputs/cofog_bg.json'),
    read<PopulationInput>('inputs/population.json'),
    read<MeasureSource>('inputs/measures_2026.json'),
    read<MeasureExcerpts>('inputs/measure_excerpts.json'),
    read<AnnualForecast>('inputs/budget_forecast_2027.json'),
  ]);
  return {
    annex: loadAnnex(source.tables),
    tables: source.tables,
    differingRows: source.docx_check.differing_rows,
    pages,
    functions: functions.functions,
    cofog,
    population,
    measures,
    excerpts,
    forecast,
  };
}
