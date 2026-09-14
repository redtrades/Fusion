# Issue 300: native overlay checkpoint persistence

Scope: A3, under the coordinator's issue 300 implementation authorization. Evidence mode: source and isolated PostgreSQL execution. This is not production runtime acceptance or an independent review.

## Contract

`TaskStore.updateWorkflowOverlayStateFenced(taskId, input)` accepts `admission: {runId, leaseEpoch, agentId, nodeId}`, `expectedPhaseCount`, `operationId`, and `nextState: {runId, claimId, occurrence, phaseCount, previousEnvelope, reviewedHeadOid, receipts}`. The checkpoint runId is the graph run, distinct from admission.runId (native checkout ownership). claimId remains immutable within that graph run; occurrence is a monotonic accepted-phase count bounded by phaseCount. The next state appends exactly one receipt without changing the receipt prefix. All input is owned JSON before an asynchronous boundary; unknown state/admission fields and lossy values are rejected.

Storage is `task.sourceMetadata.procedureEngineLive.runs[graphRunId]`. Each checkpoint also stores `writeFence: {admission, operationId, expectedPhaseCount}`. Other runs and source metadata are preserved. The namespace permits at most 256 phases across all runs and 1 MiB serialized bytes; exhaustion refuses rather than evicts evidence.

The project-bound PostgreSQL transaction takes the same advisory task lock as Reset, then the task row lock. It rejects missing/deleted rows and mismatched `checkedOutBy`, `checkoutNodeId`, `checkoutRunId`, or `checkoutLeaseEpoch`. A new run can initialize its own checkpoint after valid admission. A valid replacement lease for the same run can append or replay, without rewriting earlier receipt provenance. An old lease is refused before replay checks.

The acknowledgement is `{applied:true, task, state, replayed}` or `{applied:false, reason}`. `state` is the selected run's checkpoint without `writeFence`. Only an exact retry of the latest operation/state returns replayed success. Database commit precedes the normal task projection; if the projection fails, an exact retry recovers authoritative acknowledgement without appending again. Older operations after subsequent progress are refused.

## Verification

The new PostgreSQL suite initially failed on the missing method. Eleven tests now execute against an isolated local PostgreSQL cluster: separate store contention, Reset/write ordering, stale lease refusal, same-run takeover, Reset/new-run history preservation, exact replay, projection-failure retry, receipt prefix preservation, malformed/oversized payload refusal, missing/deleted/unavailable storage, distinct graph/checkout identifiers, and two graph runs under one checkout. The Reset test observes an actual PostgreSQL advisory-lock waiter from a separate TaskStore. Core TypeScript and scoped production ESLint pass. No shared database, service, inference, or public remote was used.

## Remaining scope and negative evidence

A3 does not implement the terminal metadata-plus-column transaction (A4), native dispatcher session association, the overlay's durable read/restore adapter, or live end-to-end acceptance. Generic `updateTaskAtomic` is insufficient because its lock is local to one store. Task document writes do not supply this CAS. Existing task updates use `sourceMetadataPatch`, not `sourceMetadata`; the first preservation test exposed that fixture mistake and was corrected without weakening its assertion.

The dependency symlinks and test cluster are local environment, not repository authority. Different-family review on the exact local commit remains required. Do not push to either public Fusion remote.

## A4: terminal checkpoint and lifecycle transition

`TaskStore.applyWorkflowOverlayTerminalFenced(taskId, {...checkpointInput, expectedColumn, targetColumn})` appends the terminal receipt and commits the existing native lifecycle move in the same transaction. The native layer does not classify WS16 reason strings. The caller supplies that meaning in the immutable terminal receipt and selects a configured column; existing move policy remains authoritative.

The move transaction rechecks native ownership, checkpoint phase count, original column, and PostgreSQL row revision. It publishes the checkpoint through the existing task upsert, transition-pending marker, and transactional move audit. It does not write a column through an alternate SQL path. A database-trigger failure in the native audit rolls back both checkpoint and column.

A terminal checkpoint's writeFence contains `terminal: {expectedColumn,targetColumn,fullTransactionId,rowRevision}`. Exact replay requires the original operation/state/admission, same final column and lease epoch, matching actual PostgreSQL xmin, and a full transaction age below half the 32-bit transaction range. Future, malformed, wrapped, and ambiguous revisions refuse replay. After the existing upsert, the actual row xmin is checked inside the transaction; a savepoint/subtransaction mismatch fails rather than being assumed valid.

The first A4 replay test found that the native postcommit transition-pending clear changes xmin. For this path, that existing clear now runs with a conditional fence advancement in one advisory- and row-locked transaction. An intervening Reset/reclaim prevents both clear and advancement. Other lifecycle callers retain their original clear path. A crash before this cleanup still leaves a committed terminal receipt and native pending recovery marker; exact retry does not duplicate lifecycle dispatch or its audit.

Verification: 28 tests across the two new PostgreSQL suites, transaction-wrap boundary tests, and existing Reset/terminal-recovery suites pass. These include same-column publication, lost projection acknowledgement, ordinary-checkpoint-versus-terminal distinction, separate store contention, invalid target refusal, Reset between preflight and publication, and same-column Reset superseding replay. Core TypeScript and scoped production ESLint pass. These store tests exercise native lifecycle mechanics with fixture columns; they do not prove live WS16 configured hold-column routing or whole-workflow acceptance.

## Solar review disposition on A3 revision 673bcad992054c77dfbed24a35eea879a66b22ab

The exact revision review is retained as FIX; this disposition does not rewrite its verdict or claim independent approval of later changes.

- Identifier inequality: rejected. Graph run identity and native checkout identity are distinct concepts but may contain the same string. The native store compares each to its proper authority; imposing inequality would reject a valid binding. A new PostgreSQL case explicitly succeeds with equal strings.
- Advisory-lock identity concern: rejected. The advisory lock serializes Reset; it is not a claim identity. The transaction also locks the row with FOR UPDATE, which orders ordinary SQL updates regardless of whether they take the advisory lock, then compares the authoritative native ownership fields. Existing real PostgreSQL stale-owner tests change checkout ownership through ordinary updateTask and prove the old writer is refused; separate-store concurrency and an observed advisory waiter prove the cross-instance path. A legitimate new owner reading the new row is supposed to succeed.
- Null previous envelope: clarified and tested. The native storage layer does not implement WS12 lineage policy. It stores the upstream-validated checkpoint; a rejected phase can leave occurrence at zero and previousEnvelope null across multiple receipt appends. The new PostgreSQL test preserves this state explicitly.
- Projection failure: reproduced and fixed. PostgreSQL-backed getTask reads the authoritative row (reads.ts getTaskImpl); readTaskJson also prefers PostgreSQL and uses task.json only as a fallback when no live row exists. Nonetheless, task.json and a watching store's taskCache could remain stale after an exact replay. A regression test proved that state: the database read was current while the projection remained old. Both checkpoint and terminal exact retries now refresh disk/cache and emit the normal task-updated notification without repeating the database mutation or move audit. The tests assert repaired file and cache contents, not only a positive acknowledgement.

Verification after this correction: 21 tests across the two new PostgreSQL suites and transaction revision boundary suite pass; core TypeScript and scoped production ESLint pass. The prior seven existing Reset/terminal-recovery tests passed at the A4 boundary. All tests used a dedicated local PostgreSQL cluster. Local source revision still requires different-family review before integration.
