# Reset composed focused verification

Verified exact integration `a18f9d1370dfcbdf4ec57b6331ff457995075b5a` (before and after), incorporating Reset source `a889f0c0b8c4782619b7ed663bdc7503b6854d21`. No source edits, database, live 4040, model calls, or service launches.

All three commands ran with their package directory as cwd under `/Users/man/worktrees/Fusion/300-live-integration/packages/`.

```sh
# cwd: packages/core
FUSION_PG_TEST_SKIP=1 ./node_modules/.bin/vitest run src/__tests__/task-reset-targets.test.ts src/__tests__/worktree-path-reservation.test.ts --silent=passed-only --reporter=verbose
# cwd: packages/engine
FUSION_PG_TEST_SKIP=1 ./node_modules/.bin/vitest run src/__tests__/worktree-pool.test.ts src/__tests__/reset-worktree-removal.test.ts src/__tests__/reset-branch-cleanup.test.ts --silent=passed-only --reporter=verbose
# cwd: packages/dashboard
FUSION_PG_TEST_SKIP=1 ./node_modules/.bin/vitest run src/__tests__/task-reset-lifecycle.test.ts src/__tests__/task-reset-workspace-lifecycle.test.ts --silent=passed-only --reporter=verbose
```

- Core: 2 files, 21 tests passed, exit 0. `/tmp/268-composed-core.log`.
- Engine: 3 files, 46 tests passed, exit 0. `/tmp/268-composed-engine.log`.
- Dashboard: 2 files, 44 tests passed, exit 0. `/tmp/268-composed-dashboard.log`.
- Total: 7 files / 111 passed / zero failed / zero skipped. FUSION_PG_TEST_SKIP prevented optional PG participation; no selected test was skipped.

Tracked tree remains clean. Existing root-owned untracked `reports/issue-303-codex-structured-handshake/independent-review/` and `native-canary/` were preserved. Core/engine builds and broader agent composition tests remain coordinator-owned. These focused source tests do not prove deployment or live KB-003 Reset/rerun completion.
