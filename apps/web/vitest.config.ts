import { sharedCoverage } from '../../vitest.shared.ts';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    coverage: sharedCoverage([
      'app/**/*.{ts,tsx}',
      'client/**/*.js',
      'workers/**/*.{ts,js}',
      'public/sw.js',
      'scripts/candidate-data.ts',
    ]),
    environment: 'node',
    include: ['app/**/*.test.{ts,tsx}', 'workers/**/*.test.ts'],
  },
});
