# Issue 300: native overlay checkpoint persistence

Scope: A3, under the coordinator's issue 300 implementation authorization. Evidence mode: source and isolated PostgreSQL execution. This is not production runtime acceptance or an independent review.

## Contract

`TaskStore.updateWorkflowOverlayStateFenced(taskId, input)` accepts `admission: {runId, leaseEpoch, agentId, nodeId}`, `expectedPhaseCount`, `operationId`, and `nextState: {phaseCount, previousEnvelope, reviewedHeadOid, receipts}`. The next state appends exactly one receipt without changing the receipt prefix. All input is owned JSON before an asynchronous boundary; unknown state/admission fields and lossy values are rejected.

Storage is `task.sourceMetadata.procedureEngineLive.runs[runId]`. Each checkpoint also stores `writeFence: {admission, operationId, expectedPhaseCount}`. Other runs and source metadata are preserved. The namespace permits at most 256 phases across all runs and 1 MiB serialized bytes; exhaustion refuses rather than evicts evidence.

The project-bound PostgreSQL transaction takes the same advisory task lock as Reset, then the task row lock. It rejects missing/deleted rows and mismatched `checkedOutBy`, `checkoutNodeId`, `checkoutRunId`, or `checkoutLeaseEpoch`. A new run can initialize its own checkpoint after valid admission. A valid replacement lease for the same run can append or replay, without rewriting earlier receipt provenance. An old lease is refused before replay checks.

The acknowledgement is `{applied:true, task, state, replayed}` or `{applied:false, reason}`. `state` is the selected run's checkpoint without `writeFence`. Only an exact retry of the latest operation/state returns replayed success. Database commit precedes the normal task projection; if the projection fails, an exact retry recovers authoritative acknowledgement without appending again. Older operations after subsequent progress are refused.

## Verification

The new PostgreSQL suite initially failed on the missing method. Ten tests now execute against an isolated local PostgreSQL cluster: separate store contention, Reset/write ordering, stale lease refusal, same-run takeover, Reset/new-run history preservation, exact replay, projection-failure retry, receipt prefix preservation, malformed/oversized payload refusal, and missing/deleted/unavailable storage. Core TypeScript and scoped production ESLint pass. No shared database, service, inference, or public remote was used.

## Remaining scope and negative evidence

A3 does not implement the terminal metadata-plus-column transaction (A4), native dispatcher session association, the overlay's durable read/restore adapter, or live end-to-end acceptance. Generic `updateTaskAtomic` is insufficient because its lock is local to one store. Task document writes do not supply this CAS. Existing task updates use `sourceMetadataPatch`, not `sourceMetadata`; the first preservation test exposed that fixture mistake and was corrected without weakening its assertion.

The dependency symlinks and test cluster are local environment, not repository authority. Different-family review on the exact local commit remains required. Do not push to either public Fusion remote.
