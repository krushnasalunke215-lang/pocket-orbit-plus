import { defineConfig } from 'vitest/config';

// No plugins: the IWSDK dev plugin must never load in unit tests.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
