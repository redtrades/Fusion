# A2 RED-only native projection findings

Base/frozen A1: `0cbfe89281ed41a1147466a03dc4deefb95f61f9`. Worktree `/Users/man/worktrees/Fusion/268-step-projection-red`. Evidence mode fallback source plus real isolated PostgreSQL. Only new test/report files; no production changes or live task access.

## F1 — Missing production callback, reproduced

`deterministic-step-projection.pg.test.ts` runs the actual graph executor with a sequential/shared `gateMode:gate` named-script template and real native TaskStore. The handler observes pending at entry, invokes native runConfiguredCommand with harmless printf (marker and exit0 asserted), and reports success. Task step remains pending afterwards. Both expected in-progress-at-entry and done-after-completion assertions fail. This establishes missing graph projection, not a failing shell command.

## F2 — Native projection alone can complete a new owner's task step

The proposed existing API sequence `startStep(...,{source:"graph"}) → deferred command → updateStep(...,"done",{source:"graph"})` was tested in the SAME process against actual PG.

1. Accepted native start; hold completion. Run actual `resetTaskPublication`, then install a replacement pending step with a different name and new checkout/run/epoch through supported native updateTask. Readback verifies replacement pending and new run/epoch. Release old completion. Native updateStep marks the new owner's replacement step done. Expected refusal is RED.
2. Accepted native start; hold completion. Clear checkout identity with native updateTask and verify checkedOutBy/checkoutRunId absent. Release old completion. Native updateStep marks done despite released owner. Expected refusal is RED.

These are native-mutation seam tests, not an implemented A2 callback or a claim that every dashboard Reset route omits cancellation. They falsify the broad assumption that same-process outer admission alone makes stale completion impossible. Reset also clears steps; the replacement-plan case intentionally recreates index0 under new ownership to test realistic late completion, rather than stopping at an out-of-range error.

## Counts and execution evidence

Two isolated PG runs: **3 failed tests / 5 passed / 0 skipped** each (8 cases; first test contains two failing assertions). `confirmed-actual-pg-red.log` includes the actual harmless command and verified ownership readbacks. Green controls: native dependency start refusal; script failure, skipped, advisory-failed and cancellation leave steps non-done. Those negative graph controls are regression boundaries, NOT proof the missing eligibility predicate is implemented.

A1's existing foreach/optional-group suites already passed on this exact production source (76 tests overall); no production change here necessitated repeating them. Existing step-review and integration owners are unmodified. No new inference, real CLI model process, HTTP service, live4040/KB003 or live DB.

Runner: `/tmp/fusion268-step-projection-red-run.mjs`, adapted from root's prior PG runner. Ephemeral loopback port and uniquely named temp database; finally calls pg.stop. No process matching the dedicated database prefix remains after execution. Important negative evidence: outer Node wrapper reported exit0 even though child Vitest visibly failed (including after explicitly retaining the child code around cleanup). Do not use outer wrapper success as a test verdict. The exact named assertion failures/counts are retained; no green claim. Dependency install used --ignore-scripts, and the already-hydrated PG dependency from the earlier isolated budget worktree was reused; no upstream package defect claimed.

## Smallest supported next fix — requires native mutation fencing

Production source references relative to packages:
- `core/src/store.ts:2749–2754`: startStep/updateStep have no run admission parameter.
- `core/src/task-store/merge-queue-ops.ts:72–88,374–389,399–409`: graph-source mutation uses withTaskLock, writes task JSON, emits transition. Retain its dependency/pinned-index/ledger checks.
- `core/src/task-store/task-id-integrity.ts:552`: lock is an in-process promise chain, not Reset's transaction lock.
- `core/src/task-store/task-mutation-ops.ts:548–625`: existing field-bounded workflow-result writer demonstrates task advisory transaction plus in-transaction read/compute; its permitted fields exclude Task.steps. Do not misuse that writer or call startStep/updateStep from its non-reentrant compute callback.
- `core/src/task-store/cli-token-usage-ops.ts:27–48`: existing native checkout tuple/project enforcement inside task transaction provides a precedent, not a new generic protocol.

Recommendation: before wiring A2, extend the existing graph-source step mutation boundary narrowly to accept captured native run/agent/node/lease ownership and optional abort signal, validate against the CURRENT row under Reset's advisory lock plus row lock, then run the existing step transition policy and persist only its owned columns/log effects. Do this for both accepted start and terminal completion. A pre-read or signal check outside the commit is insufficient. Preserve existing callers' behavior; no generalized patch writer, operatorOverride, new lifecycle taxonomy or manual completion. Exact same-lease attempt identity may also need the existing run/foreach/index mapping; test it before claiming replay correctness.

Then add the restricted shared/sequential all-script blocking-template callback in existing foreach/production DI. Require actual execution success and no notRunReason; advisory traversal success and reaching template exit alone are insufficient. Preserve step-execute/review and worktree-integration completion authority. Fail closed on rejected start/completion and do not mark the instance completed after suppressed task projection.

No production implementation performed. Root must settle the narrow mutation surface before GREEN work; A1 stays immutable for independent Grok review.

## Proposed exact API/caller boundary (design only)

Extend only the existing options object on `startStep` and `updateStep` with optional `ownership: { runId: string; leaseEpoch: number; agentId: string; nodeId: string }` and `signal?: AbortSignal`, valid for `source:"graph"`. A2's new production DI callback MUST supply all four captured native checkout fields and the graph AbortSignal. An absent/partial tuple is a refusal for this new protected callback, never a reason to silently use legacy unfenced behavior. Keep existing method return types; rejected ownership must not look like accepted start or durable completion. Concrete new callback calls:

```
store.startStep(taskId, stepIndex, { source: "graph", ownership, signal })
store.updateStep(taskId, stepIndex, "done", { source: "graph", ownership, signal })
```

The shared enforcement location is `mutateStepImpl` in `core/src/task-store/merge-queue-ops.ts`, with signatures forwarded by `core/src/store.ts`. Extract/reuse its existing transition decision so the protected transaction path cannot fork dependency/ledger policy. Do not pretend `RunMutationContext` is an ownership fence: `types/task/task-log.ts:61` contains runId/agentId/source only, no nodeId or leaseEpoch. The existing `WorkflowOverlayAdmission` tuple in task-mutation-ops.ts:399–404 matches the needed native fields but coupling generic step ownership to overlay terminology should be avoided.

New engine callers only: production DI in `executor/execute-workflow-graph.ts` to foreach lifecycle callbacks, invoked at accepted instance start and verified blocking completion. Existing `execution/step-runner.ts:158,201`, `executor/create-authoritative-workflow-seams.ts:661` through updateStepGraph, and `executor/build-foreach-worktree-deps.ts:229` must remain behaviorally unchanged in this bounded slice. No silent widening to AI review, legacy tools or worktree-integration ownership. Root approval of the transactional extraction is required before implementation, as requested; no code for it exists in this RED revision.
