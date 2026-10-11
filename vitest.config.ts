import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    passWithNoTests: true,
    maxWorkers: 2, // agents run tests concurrently: keep CPU use bounded
  },
});
