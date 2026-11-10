import { catalog, core } from './catalog.js';
import { Check } from './checks.js';
import { Context } from './context.js';
import { runGroups, UNPORTED_GROUPS, type Exception, type Group } from './runner.js';

export const WAVE17A_GROUPS = ['CORE', 'CATALOG'] as const;
export const WAVE17A_REMAINING = UNPORTED_GROUPS.filter(
  (x) => !(WAVE17A_GROUPS as readonly string[]).includes(x),
);
export const wave17aGroups: Group<Context>[] = [
  { name: 'CORE', description: 'cross-check core copies against their owners', run: core },
  {
    name: 'CATALOG',
    description: 'cross-check catalogue statements against files and sources',
    run: catalog,
  },
];
const gone =
  'СЕБРА (daily payments) was taken out of the active interface and of core.sources; data/sebra.json stays on disk, unreferenced, for phase 2';
// Exact observations covered by the donor's production compatibility patterns. Narrowing
// the older broad patterns ensures that a new source or file-count defect still fails.
const accepted: { group: string; problem: string; reason: string }[] = [
  {
    group: 'CORE',
    problem:
      "sources: keys ['asbp', 'bill', 'bnb', 'budget2027', 'customs-excise-law', 'dataeuropa', 'dbp2027', 'ec-dbp', 'ec-edp-bg', 'ec-fiscal-bg', 'ec-oil', 'eurostat', 'excise-law', 'gisco', 'kfp', 'minfin', 'nap', 'nsi-pack', 'parliament', 'prb', 'wg', 'zbdoo', 'zbnzok', 'zdb']",
    reason: gone + " (the donor expects the 'sebra' source key)",
  },
  {
    group: 'CATALOG',
    problem:
      "files on disk but not in the catalog: ['dbp2027.json', 'sebra.json']; in the catalog but not on disk: []",
    reason: gone + '; Screen S34: dbp2027.json is not listed in catalog.json (S24 would change)',
  },
  {
    group: 'CATALOG',
    problem:
      "counts {'datasets': 33, 'files': 67, 'real': 26, 'mock': 0, 'pending': 7, 'primarySources': 50} do not match the catalog {'datasets': 33, 'files': 69, 'real': 26, 'mock': 0, 'pending': 7, 'primarySources': 50}",
    reason: gone + ' (the catalog counts the listed files, the folder holds one more: sebra.json)',
  },
];
export function applyWave17aExceptions(c: Check, enabled = true): Exception[] {
  if (!enabled) return [];
  const found: Exception[] = [];
  const keep: string[] = [];
  for (const problem of c.problems) {
    const match = accepted.find((x) => x.group === c.name && x.problem === problem);
    if (match) found.push({ group: c.name, problem, reason: match.reason });
    else keep.push(problem);
  }
  if (found.length) c.fact(`${found.length} accepted documented contract exception(s)`);
  c.problems.splice(0, c.problems.length, ...keep);
  return found;
}
export function runWave17a(ctx: Context, wanted: string[], useAccepted = true) {
  if (!wanted.length) throw new Error('Explicit group selection is required');
  const names = wanted.map((x) => x.trim().toUpperCase());
  if (names.some((x) => !(WAVE17A_GROUPS as readonly string[]).includes(x)))
    throw new Error(
      `unknown or unported group: ${names.find((x) => !(WAVE17A_GROUPS as readonly string[]).includes(x))}`,
    );
  const results = runGroups(wave17aGroups, ctx, names),
    raw = results.groups.map((c) => ({
      name: c.name,
      n: c.n,
      problems: [...c.problems],
      warnings: [...c.warnings],
      facts: [...c.facts],
    }));
  const exceptions = results.groups.flatMap((c) => applyWave17aExceptions(c, useAccepted));
  const totals = {
    checks: results.groups.reduce((a, c) => a + c.n, 0),
    problems: results.groups.reduce((a, c) => a + c.problems.length, 0),
    warnings: results.groups.reduce((a, c) => a + c.warnings.length, 0),
  };
  return {
    scope: 'wave17a' as const,
    completeValidation: false as const,
    unported: WAVE17A_REMAINING,
    accepted: useAccepted,
    raw,
    groups: results.groups,
    exceptions,
    totals,
    status: totals.problems ? ('FAIL' as const) : ('PASS' as const),
  };
}
