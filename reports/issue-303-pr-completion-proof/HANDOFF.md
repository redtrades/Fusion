# Native PR completion bridge RED proof

Base81266c204; isolated branchcodex/303-pr-completion-proof. Test/report only; production untouched. Root integration subsequently379c94d5e includes reviewed expected-head CLI fix, but the engine PR handlers/reconciler/finalizer tested here are unchanged.

## Actual result

Two deliberate RED cases (no complete column / declared complete column): real custom selected graph pr-create→pr-merge→end completes its walk. Actual native handlers write a real PR entity and task PR link; fake provider merge returns requested-only. Assertions establish entityopen, no taskmergeConfirmed and sourceclose0 before reconciliation. Actual PrReconciler.reconcileRepoOnce receives authoritative fake-provider merged/headA; actual entity becomesmerged and github:pr-merged transition fires. Actual TaskExecutor.finalizeMergeConfirmedWorkflowGraphTask then returnsfalse, task remainsin-progress, mergeConfirmednull, sourceclose0. Declaring a complete column alone does not supply task merge proof. Expectedfinalizedtrue is intentionallyred; no assertion was weakened.

`red.log` contains exact task/workflow/entity IDs and result receipts,2fail, ephemeralPG stopped. Test: packages/engine/src/__tests__/pr-entity-completion-bridge.pg.test.ts. Runner `/tmp/303-pr-completion-run.mjs`; config `/tmp/303-pr-completion.vitest.config.mts`. Execute `node /tmp/303-pr-completion-run.mjs` only after restoring isolated dependency links and auditing exact paths. Real PostgreSQL harness owns temporary database, intercepted provider has no network/auth.

## Scope and limits

Real TaskStore/selected definition/native graph runner, real PR handlers and reconciler/default external-event release, actual TaskExecutor finalization method, actual GitHubSourceIssueCloseService are exercised. GitHubClient/auth resolution are intercepted at module boundary using gh-cli-shaped fixture resolution; no credentials read. No mergeConfirmed/done/PRmerged field is manually set. Remote merged state enters only through reconciler API. Request receipt is a fake remote return, not an actual hosted merge.

This is NOT a full TaskExecutor.execute/ProjectEngine scheduler boot, actual remote PR, killed-runtime recovery, native lease-race or model test. No real principal admission is claimed for this minimal non-model PR slice. Reconciler writes actual store rows with native persistence, but the test makes no new transaction/lease guarantee. It waits for the reconciler's asynchronous PR mirror write before asking the finalizer, avoiding a false missing-bridge result from that pending write. Sourceissueclose service is active throughout; no manual event is emitted.

## Source-grounded missing seam

pr-reconcile.ts404–465 updates only entity mirror then releases external-event holds. That does not establish Task.mergeDetails.mergeConfirmed; current graph does not park in that external hold. execute-workflow-graph.ts1224–1229 only invokes merge-confirmed finalization when taskproof exists. merge-confirmed-finalize.ts24 immediately refuses absent proof. Full self-healing search found no PRentity/GitHubstatus consumer; its landed-task routes prove git ancestry separately. Do not infer those routes ran or can replace the exact reviewed PR contract.

There IS a separate native completion owner: serve.ts431→ProjectEngine processPullRequestMerge queue→CLI processPullRequestMergeTask. That path requires resolved merge/review lane and native blockers; current WIP-only ADW does not enter it. Its private finalizePullRequestMerge at1128 cleans artifacts, moves through native complete resolution and emits task:merged after remote confirmation. It is not a standalone exported callback safe to call from PRreconcile: it lacks an explicit current graph/lease fence and performs cleanup before move.

Next options are in `/tmp/303-pr-completion-options.md`; no production change authorized or made in this RED slice. No changeset for test/report-only work. Dependency links removed beforefreeze.
