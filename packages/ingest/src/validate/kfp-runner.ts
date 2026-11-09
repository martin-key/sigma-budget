import { Context } from './context.js';
import { kfp, type KfpEvidence } from './kfp.js';
import { runGroups, UNPORTED_GROUPS } from './runner.js';

export function runWave18(context: Context, evidence: KfpEvidence, wanted: string[]) {
  if (wanted.length !== 1 || wanted[0]?.toUpperCase() !== 'KFP')
    throw new Error('wave18 supports only the explicit KFP group');
  const result = runGroups(
    [
      {
        name: 'KFP',
        description: 'independent monthly reports',
        run: (ctx: Context) => kfp(ctx, evidence),
      },
    ],
    context,
    ['KFP'],
  );
  return {
    scope: 'wave18',
    completeValidation: false as const,
    rawEvidence: evidence.rawPresent ? 'captured-originals' : 'absent',
    unported: UNPORTED_GROUPS.filter((x) => x !== 'KFP'),
    groups: result.groups,
    totals: { checks: result.checks, problems: result.problems, warnings: result.warnings },
    status: result.problems ? ('FAIL' as const) : ('PASS' as const),
  };
}
