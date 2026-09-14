import base from '../../packages/core/vitest.config.ts';
import { resolve } from 'node:path';
export default {
  resolve: { ...base.resolve, alias: { ...base.resolve.alias, '@fusion/engine': resolve(import.meta.dirname, '../../packages/engine/src/index.ts') } },
  test: { include: ['packages/engine/src/__tests__/task-merge-route.pg.test.ts'], exclude: [], maxWorkers: 1, testTimeout: 15000, hookTimeout: 30000 },
};
