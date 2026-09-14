# Native reviewed-head callback handoff

Baseee8e725b9525704f6143bb0b9a4f92857a8c7b33. Isolated branchcodex/303-native-exact-head. Scope only createPrNodeGithubOps merge callback, six added actual-callback tests, changeset and reports. No remote Git/provider, database, runtime, inference, config or credential operation. All child-process Git calls in tests are intercepted by the existing test harness, provider is a spy; this is not remote acceptance.

## Behavior

A supplied expectedHeadOid must equal the refreshed head before fence persistence or provider merge; otherwise return stale-head. With a supplied matching fence the provider receives that exact expectedHeadOid even if native auto-merge is enabled. Callers omitting the fence retain existing auto:true/direct refreshed-head behavior. Cancellation is rechecked after the final awaited auto-merge settings resolution and before provider mutation. Existing provider stale-head errors are returned without another merge call.

The refresh helper may already have refreshed/published a branch before the mismatch refusal; this slice prevents merging an unreviewed head, not all earlier Git writes. It does not implement autoMerge policy, selected graph completion, issue close, native principal admission or authorize remote execution. Those remain coordinator-owned.

## Symptom verification

Original symptom: callback ignored caller fence, replaced it with refresh output or unfenced auto:true, and cancellation during final awaited settings still reached merge. Exact final regression against original callback:4 fail/14 pass/61 deliberately filtered tests in red.log. Fixed full file:79 pass/0 skipped in tests.log. Provider race and no-fence existing behavior also pass. No hand-written substitute callback.

Commands (cwd packages/cli unless noted):
```sh
FUSION_PG_TEST_SKIP=1 ./node_modules/.bin/vitest run src/commands/__tests__/task-lifecycle.test.ts --testNamePattern=createPrNodeGithubOps --reporter=verbose
# Full fixed suite from repository root:
FUSION_PG_TEST_SKIP=1 packages/cli/node_modules/.bin/vitest run --root packages/cli src/commands/__tests__/task-lifecycle.test.ts --reporter=verbose
./node_modules/.bin/tsc --noEmit
# Repository root:
./node_modules/.bin/eslint packages/cli/src/commands/task-lifecycle.ts packages/cli/src/commands/__tests__/task-lifecycle.test.ts
node scripts/check-changeset-format.mjs
git diff --check
```

CLI typecheck passes exit0; scoped ESLint exit0 (test file intentionally ignored by existing config, one warning); changeset format and diff checks pass. The temporary original-callback swap for final red was restored byte-for-byte to the tested fix. Dependency symlinks used only this worktree and were removed before commit. Root handles exact different-family review and integration; neither is claimed here.

Negative evidence: first edit used wrong cwd and did not write tests. Initial stale-error fixture used an error name rather than native code:stale-head and was corrected to the existing API. An initial check-changesets.mjs command named a nonexistent script; actual check-changeset-format.mjs passed. These setup errors are not product failures or acceptance evidence.
