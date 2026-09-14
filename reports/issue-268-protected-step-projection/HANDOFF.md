# A2 protected deterministic step projection

Evidence mode: fallback native source and executable isolated tests. Base frozen A1 `0cbfe89281ed41a1147466a03dc4deefb95f61f9`. Worktree `/Users/man/worktrees/Fusion/268-protected-step-projection`, branch `codex/268-protected-step-projection`. No edits to shared/integration/A1/RED trees; no public push, auth/config change, model invocation, deployment or live4040/KB003/303 task operations.

## Implemented boundary

- Native `startStep` and `updateStep` share one extracted step transition policy. Their legacy call path remains process-locked with the existing persistence/events/chat behavior.
- New graph-only options require ownership `{runId,leaseEpoch,agentId,nodeId}`, ordered `expectedSteps` definitions excluding status, and signal. Partial protected requests fail closed. Input tuple/plan are cloned before waiting; absent dependsOn and [] remain different.
- Protected writer: native task lock → transactionImmediate → Reset's task advisory lock → project-scoped row FOR UPDATE → live task/owner/plan/pause/abort checks → shared transition policy → owned steps/log/reports/currentStep/stuck-kill/updatedAt columns only → final in-transaction abort check → postcommit file mirror/events/best-effort chat. No nested public mutation or atomicWriteTaskJson transaction.
- Completion additionally requires the current step in-progress. Native suppression cannot become accepted completion.
- Production factory captures the native task identity/plan. Only shared sequential templates of ordinary blocking named scripts acquire deterministic completion authority. All scripts must produce actual `scriptSucceeded:true`, no notRunReason, and successful graph outcome. Native start precedes command; native done precedes instance completed. Failed projections mark the instance failed.
- Script kind itself is NOT an ownership separator: workflow-node-handlers uses promptLike for script and honors config.seam; custom runner can select cli-agent before named script. Eligibility therefore explicitly excludes seam/reviewKind/workflowAction/awaitInput/raw-command and alternate executor configurations. Existing step-execute/review and worktree integration owners remain unchanged.

## Verification

- Pre-production expanded RED: **6 failed / 5 passed / 0 skips**, including actual missing graph projection, corrected release, Reset/replan, same-lease changed/reordered plan, absent-vs-empty dependsOn. Child exit1 retained.
- Final actual PG: **40 passed / 0 failed / 0 skips, 4 files** in pg-verified.log. New 20-case protected suite plus existing native ordering, proactive status and hybrid step storage suites. One owned ephemeral server, file execution sequential. Tests cover actual harmless printf; native start/completion ordering; native persisted instance failure/completion; stale Reset/release; changed/reordered plan; dependency semantics; pause/abort/partial options/not-started refusal; abort queued behind real Reset; snapshot capture; unrelated budget/summary preservation; graph replay without repeated command.
- Final engine: **86 passed / 0 failed / 0 skips, 4 files** in engine-tests-final.log. Includes prior A1/foreach/optional-group suites and new explicit authority exclusions/start-done ordering/refusals.
- Core build PASS (core-build-verified.log); final engine build PASS (engine-build-verified.log). Production ESLint PASS, supported changeset check and diff check recorded. Test files remain outside repo ESLint's configured scope, not claimed linted.
- No full gate/boot/runtime acceptance claimed. No live service started; no process matching the unique test PG prefix remained after verification.

## Corrections and negative evidence

The frozen RED handoff overstated checkout-release evidence. `updateTask({...undefined})` did NOT clear ownership. Its confirmed log fails SETUP with agent-old still present; the earlier unchecked case cannot prove release either. Those frozen logs remain unchanged. This revision uses the exact supported native null-field/next-epoch pattern from mesh-lease-manager, verifies cleared owner/run and incremented epoch before stale completion, and reproduced RED before production changes.

Initial GREEN rejected unscoped test harness persistence (correct fail-closed behavior); configured an explicit fixture projectId rather than weakening production. A metadata-preservation fixture initially used an unsupported updateTask sourceMetadata write; replaced it with the supported tokenBudgetOverride setter and asserted successful setup readback before completion. An initial engine build reported three implicit-any DI parameters; annotated them and rebuilt. All failure logs are retained.

The embedded PG Node wrapper swallows process exit during cleanup. Expanded log directly records TEST_CHILD_EXIT=1. A tiny outer Python wrapper now removes stale status, runs the owner Node runner, reads the child's freshly written code, and exits accordingly. pg-regression.log demonstrates CHILD_VERDICT_EXIT=1 while OUTER_NODE_EXIT=0; final verified run reports both0. Runner copies are included. Test-only PG password is synthetic, not account auth. Dependencies installed with --ignore-scripts; the prior isolated worktree's hydrated PG dependency was reused without changing it.

## Remaining limits and review

Protection proves current checkout tuple + ordered plan snapshot + in-progress completion. It does NOT distinguish identical-plan ABA or separate same-lease attempts. Existing valid in-progress resume remains accepted; no new attempt protocol or replay guarantee is invented. Advisory/failure/skipped nodes never gain completion from graph traversal alone. Unwired in-memory/legacy graph interpreters retain prior behavior; the native production constructor always supplies the protected factory. Existing instance persistence and task logs have their established durability limits; no new claim that instance and task-step writes form one transaction.

Parent owns independent different-family source review on this frozen revision and later integration/acceptance. No reviewer PASS is claimed here. A1 remains separately reviewed/frozen. Task-step projection is source-tested, not a live KB-003 acceptance result.
