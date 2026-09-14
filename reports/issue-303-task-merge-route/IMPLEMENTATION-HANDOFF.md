# Protected native task merge requester — implementation handoff

Evidence mode: fallback evidence from exact source, native component tests, and isolated PostgreSQL. No hosted merge, model execution, task scheduler start, or full claim-to-close acceptance is claimed.

## Source and integration

Implementation parent is `4c0b8f98cc4ef27ef2ce6acc76433131d05d3fbe`, the frozen O1 proof commit, whose parent is `379c94d5e7c3bb824baf9b5c3705781904848c36`. Integration must carry the proof commit plus this implementation commit. Root owns exact different-family review and subsequent integration. No public push occurred.

The existing requestMerge → mergeRequester → ProjectEngine queue → CLI PR processor → TaskStore move path now carries an owned immutable expected-head/checkout fence. Existing callers without protected options remain supported. Protected requests cannot use native GitHub auto mode, direct AI fallback, a conflicting queued request, or the ordinary automatic sweep. The selected top-level custom workflow's requireProtectedMerge policy also blocks automatic sweeps before the first request and after its cancellation.

## Native contracts

`TaskMergeRequestOptions` from @fusion/core has optional signal and protectedMerge. `ProtectedTaskMergeFence` contains expectedHeadOid, admission {runId, leaseEpoch, agentId, nodeId}, registered workflowId and expectedColumn. Native queue copies and freezes that object. Actual GitHub merge receives the original expectedHeadOid even when githubNativeAutoMerge is enabled.

Prior gate context key `workflow:protected-merge` contains {expectedHeadOid, admission, taskId, workflowId, runId}. Its outer runId is the actual graph run; admission.runId is the native checkout run. Config `requireProtectedMerge:true` on the merge-attempt node requires this proof. The zero-argument default handler contract stays intact. The handler validates task/graph scope; the primitive validates registered selected workflow ID and actual interpreter workflow name against the selected definition. No node-config reviewed head is accepted as authority.

Real registered graph dispatch now reaches this explicit protected merge-attempt handler. Legacy merge-region collapse is unchanged for other nodes. The gate-only test runner uses actual WorkflowGraphExecutor and native primitives; no synthetic merge prompt override is used.

Normal confirmed handler result is outcome success, value merged, contextPatch workflow:merge-status=merged. Requested-only is merged-requested and is not completion. The existing source-issue-close service reacts asynchronously to native task:moved; a returned merged value does not attest remote close has completed.

## Cancellation and durable completion evidence

Actual abort-on-task:moved(done) rejects the caller with `Merge request for KB-001 aborted` AFTER the PostgreSQL completion commits. Do not infer rollback or publish a failure hold solely from this rejection.

A fresh native `getTask(taskId)` plus `getTaskWorkflowSelectionAsync(taskId)` can corroborate the protected completion: exact task ID and registered selected workflow ID; task not deleted; actual selected complete-role column; mergeDetails.mergeConfirmed true, landedBranchTipSha equal the captured reviewed head, nonempty mergedAt; merged prInfo with the same expected headOid and pre-dispatch PR number/URL; and the exact captured native checkoutRunId, checkoutLeaseEpoch, checkedOutBy, checkoutNodeId. The measured move retains this checkout tuple. Never substitute current replacement ownership for the captured tuple. A3's old in-review column fence is intentionally unusable after completion.

`engine/src/merge/auto-merge-finalization.ts` private hasDurableMergeProof checks mergeConfirmed only; it is insufficient alone for protected-operation corroboration. This change uses existing persisted fields, no schema or completion service. `landedBranchTipSha` means the task/source branch tip (core task-core.ts field documentation); it does not mean destination merge commit. commitSha remains unset when the provider did not attest it.

## Verification and replay

- 28 real PostgreSQL tests pass using the committed runner/config, raw `protected-pg-green.log`.
- 153 unit tests pass: GitHub provider parsing, merge node behavior, and unchanged legacy graph parity; raw `protected-unit-green.log`.
- 16 static validators pass, raw `protected-static.log`.
- Core and engine TypeScript builds pass; CLI no-emit typecheck and fast package build pass. Fast package build uses the existing minimal dashboard asset stub and skips full release packaging; no full dashboard/release build is claimed.
- `git diff --check` passes. Independent exact-revision review remains pending.

Canonical root replay, with dependencies installed in the target checkout:

```sh
FUSION_REVIEW_ROOT=/absolute/path/to/target node /absolute/path/to/target/reports/issue-303-task-merge-route/run-protected.mjs
```

The runner selects an ephemeral loopback PostgreSQL port, explicitly sets FUSION_PG_TEST_URL_BASE/FUSION_PG_TEST_SKIP, aliases native core/engine source in that checkout, and stops its own PostgreSQL in finally. The retained successful log ends `Isolated database stopped`; runner exit status is assigned after teardown so a failed test cannot be hidden by database shutdown. No live database, port4040, KB003, auth, or provider network mutation was used.

## Negative evidence and limits

Original O1 evidence remains in HANDOFF.md/red.log. Added RED evidence: missing durable completion marker after committed cancellation; actual protected graph region collapsed to legacy merge; earlier direct-context and synthetic-prompt fixtures were not counted as actual graph acceptance. The collapse RED also captured a teardown ECONNRESET; final canonical run has zero errors and clean shutdown. A discovered recursive per-task lock from using public getTask inside moveTask was removed: preliminary guard uses the existing locked readTaskForMove snapshot, while final authority is independently checked under PostgreSQL advisory/row locks.

Tests cover original reviewed head versus refreshed head (native auto both settings), provider missing/moved already-merged head, Reset/new checkout before provider dispatch, wrong agent/node, caller cancellation, conflicting and identical queued requests, initial/postcancel automatic sweeps, both Reset/completion orderings through actual native PR callback, durable postcommit abort evidence, and real registered graph handler dispatch. Provider transports are intercepted; no hosted PR was created or merged.

Current303 compiler places protected-merge at top level (automatic-overlay prepare.mjs top-level workflow.nodes rewrite). Nested automatic merge containers are outside this acceptance slice. Existing intermediate prInfo/status writes still occur outside the protected completion transaction; do not claim all task writes are fenced. The final guard prevents stale completion/cleanup/close publication, but this does not make a remote GitHub mutation atomic with a local Reset. Provider expected-head fencing protects the remote head race. No scheduler/principal/full installed overlay traversal or three real claim→merge→close acceptance runs are implied.
