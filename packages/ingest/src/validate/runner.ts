import { Check } from './checks.js';

/** Donor ordering; extensions absent here retain their registration order at the end. */
export const GROUP_ORDER = [
  'INPUTS',
  'ENVELOPE',
  'NUMBERS',
  'SIZES',
  'PRIVACY',
  'GLOSSARY',
  'CORE',
  'KFP',
  'ANNEX3',
  'REVENUE',
  'EXPENDITURE',
  'MEASURES',
  'BUDGET2027',
  'LAW',
  'BUDGETS',
  'PROGRAMS',
  'DEBT',
  'MUNIC',
  'SEBRA',
  'COMPONENTS',
  'RATES',
  'SEARCH',
  'FEED',
  'CATALOG',
] as const;

export type Group<Context> = {
  name: string;
  description: string;
  run: (context: Context) => Check;
};
export interface RunResult {
  groups: Check[];
  checks: number;
  problems: number;
  warnings: number;
}
/** The caller must register each port explicitly; missing groups never silently pass. */
export function runGroups<Context>(
  groups: Group<Context>[],
  context: Context,
  wanted: string[],
): RunResult {
  const byName = new Map<string, Group<Context>>();
  for (const group of groups) {
    if (byName.has(group.name)) throw new Error(`group registered twice: ${group.name}`);
    byName.set(group.name, group);
  }
  if (wanted.length === 0) throw new Error('Explicit group selection is required');
  for (const name of wanted)
    if (!byName.has(name)) throw new Error(`unknown or unported group: ${name}`);
  const rank = (name: string) => {
    const i = (GROUP_ORDER as readonly string[]).indexOf(name);
    return i < 0 ? GROUP_ORDER.length : i;
  };
  const selected = [...groups]
    .sort((a, b) => rank(a.name) - rank(b.name))
    .filter((group) => wanted.includes(group.name))
    .map((group) => {
      try {
        return group.run(context);
      } catch (error) {
        const result = new Check(group.name);
        result.fail(
          `group crashed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
        );
        return result;
      }
    });
  return {
    groups: selected,
    checks: selected.reduce((n, c) => n + c.n, 0),
    problems: selected.reduce((n, c) => n + c.problems.length, 0),
    warnings: selected.reduce((n, c) => n + c.warnings.length, 0),
  };
}

const gone =
  'СЕБРА (daily payments) was taken out of the active interface and of core.sources; data/sebra.json stays on disk, unreferenced, for phase 2';
const extension =
  'Screen S34: four sources were added to core.sources (dbp2027, ec-edp-bg, ec-fiscal-bg, ec-dbp) that the donor registry does not list';
const accepted = [
  {
    group: 'ENVELOPE',
    pattern:
      /^core\.sources keys differ from the registry: \['dbp2027', 'ec-dbp', 'ec-edp-bg', 'ec-fiscal-bg', 'sebra'\]$/,
    reason: `${gone}; ${extension}`,
  },
  {
    group: 'GLOSSARY',
    pattern: /^glossary has 69 terms \(the plan says 64\)$/,
    reason:
      'Screen S34: five glossary terms (65-69) were added; the donor plan still says 64 terms',
  },
  {
    group: 'ENVELOPE',
    pattern: /^sebra\.json: meta\.source 'sebra' is not in core\.sources$/,
    reason: gone,
  },
] as const;
export interface Exception {
  group: string;
  problem: string;
  reason: string;
}
/** Apply only the unchanged documented donor patterns for the groups ported here. */
export function applyExceptions(c: Check, enabled = true): Exception[] {
  if (!enabled) return [];
  const found: Exception[] = [];
  const keep: string[] = [];
  for (const problem of c.problems) {
    const match = accepted.find((e) => e.group === c.name && e.pattern.test(problem));
    if (match) found.push({ group: c.name, problem, reason: match.reason });
    else keep.push(problem);
  }
  if (found.length) c.fact(`${found.length} accepted documented contract exception(s)`);
  c.problems.splice(0, c.problems.length, ...keep);
  return found;
}

import { Context } from './context.js';
import { envelope, glossary, inputs, numeric, privacy, sizes } from './foundations.js';
import { validateRegistry, type RegistryResult } from './registry.js';

export const PORTED_GROUPS = [
  'INPUTS',
  'ENVELOPE',
  'NUMBERS',
  'SIZES',
  'PRIVACY',
  'GLOSSARY',
  'REGISTRY',
] as const;
export const UNPORTED_GROUPS = [
  'CORE',
  'KFP',
  'ANNEX3',
  'REVENUE',
  'EXPENDITURE',
  'MEASURES',
  'BUDGET2027',
  'LAW',
  'BUDGETS',
  'PROGRAMS',
  'DEBT',
  'MUNIC',
  'SEBRA',
  'COMPONENTS',
  'RATES',
  'SEARCH',
  'FEED',
  'CATALOG',
  'INDIRECT',
  'CONTRACT',
] as const;
export const foundationGroups: Group<Context>[] = [
  { name: 'INPUTS', description: 'pinned input file set and hashes', run: inputs },
  { name: 'ENVELOPE', description: 'status and source envelopes', run: envelope },
  { name: 'NUMBERS', description: 'number and null contract', run: numeric },
  { name: 'SIZES', description: 'raw and gzip budgets', run: sizes },
  { name: 'PRIVACY', description: 'public data privacy', run: privacy },
  { name: 'GLOSSARY', description: 'terms and links', run: glossary },
];
export interface ScopedReport {
  scope: 'wave14';
  completeValidation: false;
  unported: readonly string[];
  groups: Check[];
  exceptions: Exception[];
  staleExceptions: { group: string; pattern: string }[];
  registry: RegistryResult | null;
  totals: { checks: number; problems: number; warnings: number; registryErrors: number };
  status: 'PASS' | 'FAIL';
}
/** Report only the explicitly requested wave14 scope, alongside the unported groups. */
export function runWave14(context: Context, wanted: string[], useAccepted = true): ScopedReport {
  if (!wanted.length) throw new Error('Explicit group selection is required');
  const selected = wanted.map((x) => x.trim().toUpperCase());
  for (const name of selected)
    if (!(PORTED_GROUPS as readonly string[]).includes(name))
      throw new Error(`unknown or unported group: ${name}`);
  const found: Exception[] = [];
  const f = selected.filter((x) => x !== 'REGISTRY');
  const result = f.length
    ? runGroups(foundationGroups, context, f)
    : { groups: [], checks: 0, problems: 0, warnings: 0 };
  for (const group of result.groups) found.push(...applyExceptions(group, useAccepted));
  let registry: RegistryResult | null = null;
  if (selected.includes('REGISTRY')) {
    try {
      registry = validateRegistry(context.root);
    } catch (error) {
      registry = {
        errors: [
          `registry crashed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
        ],
        gaps: {},
        describedInputs: [],
        sourceExceptions: {},
      };
    }
  }
  const totals = {
    checks: result.groups.reduce((n, c) => n + c.n, 0),
    problems: result.groups.reduce((n, c) => n + c.problems.length, 0),
    warnings: result.groups.reduce((n, c) => n + c.warnings.length, 0),
    registryErrors: registry?.errors.length ?? 0,
  };
  return {
    scope: 'wave14',
    completeValidation: false,
    unported: UNPORTED_GROUPS,
    groups: result.groups,
    exceptions: found,
    staleExceptions: found.length
      ? accepted
          .filter(
            (rule) => !found.some((e) => e.group === rule.group && rule.pattern.test(e.problem)),
          )
          .map((rule) => ({ group: rule.group, pattern: rule.pattern.source }))
      : [],
    registry,
    totals,
    status: totals.problems || totals.registryErrors ? 'FAIL' : 'PASS',
  };
}
