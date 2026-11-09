import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    maxWorkers: 1,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
