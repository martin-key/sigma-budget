import { Context } from './context.js';
import { annex3, expenditure, measures, revenue } from './fiscal.js';
import { law } from './law.js';
import { budgets, programs } from './budgets.js';
import { runGroups, UNPORTED_GROUPS, type Group } from './runner.js';

export const WAVE15_GROUPS = [
  'ANNEX3',
  'REVENUE',
  'EXPENDITURE',
  'MEASURES',
  'LAW',
  'BUDGETS',
  'PROGRAMS',
] as const;
export const WAVE15_UNPORTED = UNPORTED_GROUPS.filter(
  (name) => !(WAVE15_GROUPS as readonly string[]).includes(name),
);
export const wave15Groups: Group<Context>[] = [
  { name: 'ANNEX3', description: 'Annex 3 fiscal outlook', run: annex3 },
  { name: 'REVENUE', description: 'Revenue tree and groups', run: revenue },
  {
    name: 'EXPENDITURE',
    description: 'Expenditure functions, economic tree and COFOG',
    run: expenditure,
  },
  { name: 'MEASURES', description: 'Fiscal measures and source document', run: measures },
  { name: 'LAW', description: 'Law, bill and legislative history', run: law },
  { name: 'BUDGETS', description: 'Ministry budgets and law reconciliation', run: budgets },
  { name: 'PROGRAMS', description: 'Programme files and index', run: programs },
];
export function runWave15(ctx: Context, wanted: string[]) {
  const selection = wanted.map((s) => s.trim().toUpperCase());
  const result = runGroups(wave15Groups, ctx, selection);
  return {
    scope: 'wave15' as const,
    completeValidation: false as const,
    unported: WAVE15_UNPORTED,
    groups: result.groups,
    totals: { checks: result.checks, problems: result.problems, warnings: result.warnings },
    status: result.problems ? ('FAIL' as const) : ('PASS' as const),
  };
}
