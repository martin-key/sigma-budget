import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    maxWorkers: 1,
    coverage: sharedCoverage(['src/**/*.{ts,js}', 'bin/**/*.js']),
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

export function sharedCoverage(include: string[]) {
  return {
    provider: 'v8' as const,
    include,
    exclude: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', '**/fixtures/**', '**/__fixtures__/**'],
    reporter: ['text', 'json-summary'],
    reportsDirectory: './coverage',
  };
}
