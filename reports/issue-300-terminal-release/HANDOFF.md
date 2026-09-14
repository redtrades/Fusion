# Native terminal release handoff

Base: 4c39af127982e5664197d93da49ec371096e9844. Worktree: /Users/man/worktrees/Fusion/300-terminal-release. Evidence mode: current source and isolated real PostgreSQL; no inference or live runtime acceptance.

## Delivery

A4 atomically publishes a distinct held native task continuation, pause, immutable receipt and currentTerminal pointer. Original graph work-item finalization addresses the predecessor ID; it cannot cancel this distinct held anchor. Existing unsupported receipts remain suspended with currentTerminal:null. Explicit custom selected IR with a same-column top-level blockingNodeId is supported; builtin/default, missing and nested bindings cannot release. Workflow selection and definition rows are read under transaction locks, avoiding an unfenced configuration read.

`TaskStore.readWorkflowOverlayCurrentTerminal(taskId)` returns `{current:true,task,terminal,terminalBlock}` only when native hold, pause, receipt, column and current custom IR agree. Otherwise `{current:false}`. Historical runs and Reset-cancelled anchors cannot project as active terminal holds.

`TaskStore.releaseWorkflowOverlayTerminalFenced(taskId, request)` accepts:

- expectedGraphRunId and expectedTerminalOperationId from the validated pointer;
- releaseOperationId, unique for the release;
- expectedWorkflowIrHash;
- current native admission `{runId,leaseEpoch,agentId,nodeId}` (checkout run, distinct from graph run).

Returns `{applied:true,task,successor,replayed}` or `{applied:false,reason}`. New checkout before initial release is allowed if the held anchor remains valid. After release, only the same admitted operation can replay its still-active successor. A new lease must not recreate that successor. Completed/cancelled work items are never resurrected. Reset cancels held or active successor rows and wins over retained metadata.

The primitive assumes a trusted caller. Checkout possession or a resumeActor string does not prove human approval. Outer binding must authorize the durable human/orchestrator actor against current authenticated policy. No Board route/plugin actor binding or accepted-phase replay consumption is implemented here.

## Verification

- Isolated real PostgreSQL: 8 release tests, 13 existing A4 tests, 2 real TaskExecutor outer-handler tests pass (23 total).
- Release tests cover two-store duplicate requests; both barrier-controlled Reset/release orderings; stale/wrong owner, new lease before release and after commit; graph identity and actual custom IR edit refusal; unsupported binding; transactional rollback; postcommit projection failure and idempotent retry; terminal successor non-resurrection.
- Outer tests invoke actual handleGraphFailure and routeGraphFailureToExecutionResume after A4 with a real WIP task and held anchor, for blocked/escalated. Original continuation failed-finalization refusal is exercised through native store; full executeWorkflowGraph wrapper completion is source-inspected, not executed.
- Core and engine TypeScript checks pass; scoped production ESLint and git diff --check pass. Logs: /tmp/fusion300-release-typecheck.log, /tmp/fusion300-release-engine-typecheck.log, /tmp/fusion300-release-lint.log.
- Logs: /tmp/fusion300-release-pg.log; runner /tmp/fusion300-release-pg-run.mjs. Own ephemeral PostgreSQL stopped in finally.

## Negative evidence and limits

Initial failures were test-fixture issues: native false pause is projected as undefined; correct listing API is listWorkflowWorkItemsForTask; newly added builder needed a reachable edge. Fixed those assertions/fixtures without weakening runtime fences. Initial typecheck required a checked parser boundary cast from database jsonb unknown.

Metadata alone survives Reset and cannot authorize release. xmin cannot authorize a legitimate new checkout. Generic continuation replacement can recreate terminal rows: this release seam checks durable replay/target collisions before calling it. Actor authorization and overlay checkpoint consumption remain separate integration gates. No public push, native lifecycle policy exception, inference, credentials or live database access.
