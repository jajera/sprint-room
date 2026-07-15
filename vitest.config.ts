import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
  resolve: {
    alias: {
      '@client': '/src/client',
      '@server': '/src/server',
      '@shared': '/src/shared',
    },
  },
});
