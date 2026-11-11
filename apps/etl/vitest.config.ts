import { mergeConfig, defineConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';
export default mergeConfig(
  shared,
  defineConfig({ test: { coverage: { include: ['publication-documents/prepare.mjs'] } } }),
);
