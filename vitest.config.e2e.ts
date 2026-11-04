import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/support/containers.global-setup.ts'],
    setupFiles: [
      './test/support/containers.env.ts',
      './test/support/reset-billing-queues.setup.ts',
    ],
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
