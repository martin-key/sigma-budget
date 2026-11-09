import { Context } from './context.js';
import { feed } from './feed.js';
import { Check } from './checks.js';
import { feedMonthEnds } from './feed-independent.js';
import { GROUP_ORDER, runGroups } from './runner.js';

/** The baseline has no accepted FEED findings. Wildcard donor rules are not applied. */
export function runWave17b(ctx: Context, wanted: string[], useAccepted = true) {
  if (wanted.length !== 1 || wanted[0]?.toUpperCase() !== 'FEED')
    throw new Error('wave17b requires explicit --only FEED');
  const result = runGroups(
    [{ name: 'FEED', description: 'independent feed and RSS validation', run: feed }],
    ctx,
    ['FEED'],
  );
  const groups = result.groups;
  let independent: Check | null = null;
  if (!groups[0]!.problems.some((p) => p.startsWith('group crashed: '))) {
    try {
      independent = feedMonthEnds(ctx);
    } catch (error) {
      independent = new Check('FEED_MONTH_END');
      independent.fail(
        `group crashed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      );
    }
  }
  const extraChecks = independent?.n ?? 0,
    extraProblems = independent?.problems.length ?? 0,
    extraWarnings = independent?.warnings.length ?? 0;
  return {
    scope: 'wave17b' as const,
    completeValidation: false as const,
    unported: [...GROUP_ORDER.filter((x) => x !== 'FEED'), 'REGISTRY', 'INDIRECT', 'CONTRACT'],
    acceptance: useAccepted ? 'exact-proven-findings' : 'disabled',
    exceptions: [],
    raw: groups,
    groups,
    independent,
    totals: {
      checks: result.checks + extraChecks,
      problems: result.problems + extraProblems,
      warnings: result.warnings + extraWarnings,
    },
    status: result.problems + extraProblems ? ('FAIL' as const) : ('PASS' as const),
  };
}
