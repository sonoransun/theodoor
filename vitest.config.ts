import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@theodoor/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@theodoor/programs': fileURLToPath(new URL('./programs/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'programs/test/**/*.test.ts',
      'programs/src/**/*.test.ts',
    ],
  },
})
