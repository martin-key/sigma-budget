import { Context } from './context.js';
import { runGroups, UNPORTED_GROUPS } from './runner.js';
import { search } from './search.js';

/** Initial SEARCH translation, never a complete validation result. */
export function runWave17c(context: Context, wanted: string[], accepted = true) {
  if (wanted.length !== 1 || wanted[0]?.toUpperCase() !== 'SEARCH')
    throw new Error('candidate17c supports only the explicit SEARCH group');
  const result = runGroups(
    [{ name: 'SEARCH', description: 'search rows and search reference', run: search }],
    context,
    ['SEARCH'],
  );
  // The Python wrapper defines no SEARCH exceptions. Accepted and raw results are identical.
  return {
    scope: 'candidate17c',
    completeValidation: false as const,
    mode: accepted ? 'accepted' : 'raw',
    unported: UNPORTED_GROUPS.filter((x) => x !== 'SEARCH'),
    groups: result.groups,
    totals: { checks: result.checks, problems: result.problems, warnings: result.warnings },
    status: result.problems ? ('FAIL' as const) : ('PASS' as const),
  };
}
