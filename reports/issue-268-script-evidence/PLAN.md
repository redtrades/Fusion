# #268 deterministic evidence and task-step projection — scoped source plan

Evidence mode: fallback, current Git source plus historical handoff. Read-only investigation; no DB, verifier, service, inference, source edit or pilot execution.

## Provenance and boundaries

Requested source: Fusion `a83b0e29218c55f35d87fe4b7b745d037b09f51e`. The integration checkout advanced during investigation to `a18f9d1370dfcbdf4ec57b6331ff457995075b5a`; `git diff a83b0e292... HEAD` is empty for every production file cited below. Path shorthand: `executor/` and `workflows/` mean `packages/engine/src/`; `core/src/` and `engine/src/` mean `packages/core/src/` and `packages/engine/src/`, all under `/Users/man/worktrees/Fusion/300-live-integration`.

Historical `/Users/man/Fusion/reports/KB-003-full-green-20260913/HANDOFF.md:5–16,70–75,97–100` reports two completed WF-002 foreach instances, zero node results/logs and pending task steps. WF-003 named-script replacement was never executed. Historical inspected source `2fd2432092f9ba3092e5939f46ca6267295f08ed` was explicitly NOT verified installed-binary provenance. These are old negative observations, not a fresh diagnosis of live KB-003. Reset is outside this plan.

## F1 — Actual script output and per-instance progress do not reach durable evidence

Existing implementation is sufficient to execute the command: `executor/workflow-script-step.ts:32–75` resolves `settings.scripts`, calls `runConfiguredCommand` with native abort controller/auditor, and checks spawn error, timeout and exit code. It already writes a task log at :51. However, success :75 discards stdout/stderr and returns only “Script … completed successfully”. Failure returns `error`, while `executor/run-graph-custom-node.ts:1023–1035` projects `output` and notes, not that error. Real output cannot be recovered by adding review metadata.

Two independent recording gates remain: `workflows/workflow-graph-executor.ts:2378–2383` admits marked reviews or skill prompt/gate nodes, excluding unmarked scripts/code; and :2131–2143 unconditionally calls `executeNodeWithRetries(..., false)` for materialized template nodes. Merely adding script kind to the first gate leaves foreach evidence absent. Existing materialized identity at :2140 is `workflow:node-instance-id`; persisted IDs must use the concrete instance identity, not collide on the shared template id.

The native result sink already exists: `executor/execute-workflow-graph.ts:1003–1012` → `persistWorkflowStepResultWithOutcome`, with run/attempt fencing. Start/finish writers at `workflow-graph-executor.ts:2391–2402,2467–2495` already support source `node`, output and timestamps WITHOUT reviewKind. The finish writer only logs skipped outcomes; normal completion/failure logs need a precise call. Existing host log sink :976–980 is best-effort and fire-and-forget; acceptance must read durable logs, not assume delivery from return.

A1: Preserve bounded real stdout/stderr and native exit diagnostics in `workflow-script-step.ts`, using existing `truncateWorkflowScriptOutput` (`executor/configured-command.ts:11–25`); forward failure diagnostic as output without changing verdict semantics. In the graph executor enable ordinary script progress and foreach script instance recording using existing concrete IDs. Do not globally enable optional-group template records (duplicate evidence) or attach plan/code reviewKind. Add normal terminal logs with actual captured detail, honoring cancellation and persistence outcome. The named-script pilot is the minimum slice; code-node output normalization is separate unless #268 explicitly retains WF-002 as its target.

## F2 — Script-only foreach never invokes native task-step projection

`workflows/workflow-graph-foreach.ts:1047–1065` saves only instance status completed. It does not claim to mark Task.steps done. Production wiring `executor/execute-workflow-graph.ts:950–974` supplies instance persistence and worktree integration, but no shared deterministic-instance lifecycle projection.

Existing APIs: `core/src/store.ts:2749–2754` exposes `startStep(id,index,{source:"graph"})` with accepted/disposition and `updateStep(id,index,"done",{source:"graph"})`. `core/src/task-store/merge-queue-ops.ts:72–130` enforces explicit indices/dependencies and prevents graph reparse. `engine/src/execution/step-runner.ts:155–170,193–213` invokes these around a real run, but its done-write errors are swallowed; do not equate its success return with durable done.

Current owners must remain: `executor/create-authoritative-workflow-seams.ts:342–370` routes step-execute through `runProjectedGraphTaskStep`; that module :71–80 uses runTaskStep with review deferral. Step-review is explicitly the done authority at `create-authoritative-workflow-seams.ts:409–418`. Worktree isolation already projects done only after ordered integration via `build-foreach-worktree-deps.ts:225–229`. Adding a blanket foreach done writer would violate these contracts.

A2: Add a narrow production callback for the sequential/shared, deterministic script-only template, with no step-execute or step-review owner. Invoke native accepted `startStep` before its first command; refuse dispatch if rejected. After all required blocking scripts really succeed, not skipped/advisory-failed/aborted, invoke graph-source completion and verify returned durable step status before declaring instance completed. Preserve existing dependency order, pinned step index, review deferral, rework and integration owners. Reuse native TaskStore APIs, not operatorOverride or manual rows. Do not use generic graph outcome success as assertion success: `run-graph-custom-node.ts:1118–1125` deliberately permits advisory failures to traverse success. Configure deterministic assertions `gateMode:gate`.

The existing step APIs have no explicit runContext parameter and use a task lock; do not claim new cross-process lease fencing from these calls. If #268 requires that stronger guarantee, separately assess the narrow core mutation seam before implementation, rather than adding speculative protocol here.

## Minimum implementation and proof surface

Production: `executor/workflow-script-step.ts`, `executor/run-graph-custom-node.ts` (failure output), `workflows/workflow-graph-executor.ts` (instance evidence and callback plumbing), `workflows/workflow-graph-foreach.ts` (restricted deterministic projection), `executor/execute-workflow-graph.ts` (native store callback). No new executor, graph schema, review taxonomy or manual step state.

RED-first focused tests: successful actual harmless named command preserves assertion marker and exit evidence; failing command records failure/diagnostic and never step done; two foreach instances retain distinct node records/logs and correctly ordered step states; missing script, cancellation, suppressed start, failed completion persistence and replay cannot produce full-green; review-owned and worktree-integrated templates retain their existing single completion authority. Include native store-backed projection coverage, not callbacks that manufacture states. Actual isolated runtime acceptance later must read node results, real marker logs, Task.steps and instance rows for the SAME run/IR. This plan did not run tests or accept any task.

Recommendation: implement the named-script shared foreach slice through existing sinks/projection APIs. Avoid replacing it with AI step-execute or manufacturing reviewKind merely to unlock progress. Ownership remains with the #268 coordinator; this report is implementation-ready planning, not authorization to alter live KB-003.
