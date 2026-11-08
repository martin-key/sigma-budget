import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GROUPS, ROUTES } from './routes';

describe('shared route catalogue', () => {
  it('loads identically through Vite and native Node TypeScript imports used by Python checks', () => {
    const source = new URL('./routes.ts', import.meta.url).href;
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { ROUTES, GROUPS } from ${JSON.stringify(source)}; console.log(JSON.stringify({ ROUTES, GROUPS }));`,
      ],
      { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' },
    );
    expect(JSON.parse(result)).toEqual({ ROUTES, GROUPS });
  });
});
