# Core-only cumulative accounting handoff

Evidence mode: exact source and deterministic unit/real isolated PostgreSQL execution. Base b2ffa7cf79b09ea9ee26f021058c4fd21c95d76d. Branch codex/300-hermes-cumulative-ledger; owner worktree /Users/man/worktrees/Fusion/300-hermes-cumulative-ledger. No merge/push/install, engine/plugin/Hermes source changes, model/auth or shared DB access.

## Delivered behavior

Public TaskStore.recordCliTokenUsageFenced accepts legacy CliTokenUsageWrite or explicit HermesTokenUsageWrite via NativeTokenUsageWrite. Existing legacy type remains unchanged in meaning so engine indexed observations remains an array. Hermes callers supply kind hermes-session-cumulative, actual project/task/native session/checkout ownership, cumulative usage, baseline, discriminated cursor and positive finite hard limit. No public arbitrary observation key, transcript offset/inode or model-family evidence is accepted.

Actual cliSessions row must be adapter hermes and match project/task/native ID. Existing Reset advisory+row transaction verifies captured checkout and stream owner. Internal key hermes:<nativeId>/session-cumulative deduplicates counters. Initial baseline excludes historical totals once; later baselines cannot reset credits. Any counter regression refuses. Failure accepts valid increases then remains absorbing; failure cannot be designated historical baseline. Same atomic transaction commits ledger, aggregate and hard pause. Legacy Codex/Claude behavior stays on its original path.

## Verification

- Initial RED:5 new PG failures /9 existing passes (unsupported Hermes requests).
- Additional RED:1 failure /16 passes for failed observation incorrectly designated historical baseline.
- Final:17 actual isolated PostgreSQL tests PASS,5 ledger unit tests PASS.
- Core tsc build PASS; engine tsc --noEmit PASS against candidate core (not integration core); production ESLint, changeset format, git diff --check PASS.
- PG regressions cover fresh-store replay/resumed baseline, partial-failure credit, counter rollback, strict fields/hard limit, real row adapter/identity/current lease/Reset, two concurrent stores/sessions and hard pause, numeric-overflow transaction rollback, postcommit JSON-projection failure retry.

No native process/session completeness claim: tests register actual native-store fixture rows and supply test observations. No host channel registration or per-provider coverage, no freshly read settings authority, no model-family attestation. Hard limit is supplied to this core slice; host must resolve current required limit in its separate admission layer. A failed native persistence/export cannot be represented as trusted zero here. No runtime acceptance.

## Commands and dependencies

From this checkout (dependencies available):

```sh
pnpm --filter @fusion/core build
pnpm --filter @fusion/engine typecheck
pnpm --filter @fusion/core exec vitest run src/__tests__/cli-token-usage-ledger.test.ts
node reports/issue-300-hermes-cumulative-ledger/pg-run.mjs
pnpm exec eslint packages/core/src/cli/cli-token-usage-types.ts packages/core/src/task-store/cli-token-usage-ops.ts
node scripts/check-changeset-format.mjs
git diff --check
```

No dependencies were installed. Used read-only dependency links to accepted integration node_modules; engine @fusion/core link specifically targeted this candidate core. Links are environment setup, not committed artifacts. Builds write only own dist. PG runner imports existing embedded-postgres dependency, starts its OWN temporary instance on dynamically chosen loopback port, finally stops it. Relocate its two explicit worktree paths when replaying elsewhere; never supply an application's DB URL.

## Negative evidence / limits

Original archived PG runner assigned process.exitCode before embedded PostgreSQL stop, whose cleanup reset the shell exit code. Original RED logs still faithfully show test failures; they are NOT claimed as nonzero shell status. Final runner preserves explicit Vitest exit and sets it after PG cleanup; final zero and stop receipt are direct evidence. No raw RED was overwritten. JSON projection occurs after DB commit; rejection at that point can mean committed credits. Regression proves retry idempotency, not transaction rollback of projection.

Broader product Gate/host boot is not run in this core-only slice; no real model/CLI session launched. Independent exact-revision review belongs to root/Claude, not the implementer. All raw logs preserved gzip with checksums in evidence.
