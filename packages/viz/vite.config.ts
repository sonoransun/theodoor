import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    alias: {
      // Serve core and programs straight from source — no build step during
      // development.
      '@theodoor/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@theodoor/programs': fileURLToPath(new URL('../../programs/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173 },
  build: { outDir: 'dist' },
})
