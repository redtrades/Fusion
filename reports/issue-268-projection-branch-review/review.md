==REVIEW==

CORE PACKAGE - Spec/Standards

Severity: none. The store mutation path in `packages/core/src/task-store/merge-queue-ops.ts` correctly gates protected writes behind ownership tuple + expectedSteps + signal, uses existing advisory lock / row FOR UPDATE / task lock pattern without nesting a separate public mutation inside the transaction, and rejects completion when the lease or plan changed or the step is not in-progress. `mutateStepImpl` routes protected options to `mutateProtectedGraphStep` and leaves the legacy path on the original `withTaskLock` + `atomicWriteTaskJson` path. That is what the approved contract requires and what the prior rejected e582 seam was supposed to fix.

ENGINE PACKAGE - Conditional branch regression

FIX

File: `packages/engine/src/workflows/workflow-graph-foreach.ts`
Line: 1051-1054

Concrete reproduction: the shared-isolation instance runner uses `projection` as the only authoritative verification gate. The projection check hard-codes:
- `env.signal?.aborted`
- `lastResult.outcome !== "success"`
- `lastResult.contextPatch?.scriptSucceeded !== true`
- `lastResult.contextPatch?.notRunReason !== undefined`

That means a script that reaches the template exit with outcome `"success"`, `scriptSucceeded: true`, and no `notRunReason` silently passes even when the selected branch node had outcome `"failure"` or `"unverified"`. In the approved diamond, `select -> left` (passed) or `select -> right` (failed) both reach `finish`. When the selected leaf is `right` with outcome `"failure"`, the engine already marks `lastResult = { outcome: "failure", ... }` at line 1051-1054 only when the projection predicate fires. But the projection predicate is written as a property of the projection object, not as a real acceptance condition on the leaf's outcome. The leaf outcome is already encoded in `lastResult.outcome` before this point, so the branch should be refused by the same acceptance rule that controls completion, not only by the projection gate. The current code therefore allows a failing selected branch to complete if its result value is not explicitly used in the projection check.

The test at `packages/engine/src/__tests__/workflow-deterministic-step-projection.test.ts` line 71-102 is consistent with this defect: it asserts that the diamond "honors selected branch" but the implementation it exercises does not contain a matching acceptance rule in the shared-isolation path for non-success leaf outcomes. The test passes because the fake projection's `complete` is never called on failure; but the production projection is also never called on failure, so the same blind spot is not closed by the test. The prior e582 review accepted this code path as correct and missed it.

Impact: valid accepted-IR diamond `select -> left(outcome:passed)/right(outcome:failed) -> finish` can complete even when the selected leaf is `failure` or another non-success outcome, because the shared-isolation instance runner will treat `outcome: "success"` from `chooseNextEdge` as the only failure signal at the projection gate, and it will not re-classify a non-success leaf before completion is attempted. The completion projection will then be skipped because the runner only calls `projection.complete` on the `!next` path after the projection guard on `lastResult`. The guard condition at 1051-1054 therefore does not actually protect the completion path for a leaf that already failed; it only protects against a script that returns a non-success result at the node level, and then only when projection is installed. The accepted requirement is that selected failure/unverified/skipped/cancelled must refuse completion. That requirement is not enforced uniformly in the shared-isolation instance runner.

Standards basis: the approved branch correction contract in `reports/issue-268-projection-branch-fix/PLAN.md` says "retain actual success, scriptSucceeded, absence of notRunReason, abort and fenced native completion ACK for every traversed script. No new structural-exit restriction or eligibility narrowing." The shared-isolation runner should honor that by refusing completion when any traversed script in the selected branch did not satisfy the acceptance rule, not only when the projection gate decides to reclassify the last node's result. The current shared path does not.

Likely fix shape: in the shared-isolation instance runner, the acceptance decision for the selected branch should be computed from the traversed script results in that branch, and the completion projection should be gated on that branch acceptance, not only on the final `lastResult` shape. The worktree instance path already separates integration from step completion and is not in scope for this specific projection change, so the fix is confined to `runInstance` shared path.

Alternative: if the intent was that the projection object itself is the only authority and the native side already rejects bad outcomes, then the engine must still ensure that a non-success selected branch cannot reach the completion ACK. As written, the shared path assumes the template handler's `lastResult` will already be non-success for a bad leaf and will be caught by the projection check, but the projection check is written so that a success-shaping leaf with a bad outcome value can still slip through if the projection is the only acceptance gate. Given the approved contract explicitly wants the native projection to decide completion, the engine should pass the actual acceptance verdict into the projection completion decision or should refuse completion when the branch acceptance cannot be established. Either way, the current shared path is incomplete.

No other new source-level defect found in the provided files beyond this conditional-branch acceptance gap. Legacy callers, merge queue ops, and the protected mutation fences appear consistent with the approved contract as described in the supplied commits and plans.
