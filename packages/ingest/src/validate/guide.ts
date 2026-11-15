import { readFileSync } from 'node:fs';
import { checkGuide, loadEditorialRoutes, type GuideDataset } from '../build/editorial.js';
import { Check } from './checks.js';
import { Context, safePath } from './context.js';
import type { Group } from './runner.js';

/** Validate the published guide, independently of whether a new guide was built. */
export const guideGroup: Group<Context> = {
  name: 'GUIDE',
  description: 'Published guide steps and links against the current route catalogue',
  run(ctx) {
    const check = new Check('GUIDE');
    const guide = ctx.get('guide.json') as GuideDataset;
    const routes = loadEditorialRoutes(
      JSON.parse(readFileSync(safePath(ctx.root, 'apps/web/app/lib/routes.json'), 'utf8')),
    );
    const problems = checkGuide(guide, routes);
    check.ok(problems.length === 0, 'published guide: ' + problems.join('; '));
    check.fact(`${guide.steps.length} published steps checked against the current routes`);
    return check;
  },
};
