# Native released-principal handoff plan

Base 9d552ef154389a902cbef5dd6baed7635687a0f6. Evidence: exact source and actual PG/principal admission failure, not inferred runtime acceptance. Existing release replay must keep refusing terminal successors.

## Narrow interfaces

Add `TaskStore.replaceWorkflowOverlayReleasedPrincipal(input, fence)` returning the existing WorkflowWorkItem or typed refusal. `input` is the current native principal admission's WorkflowWorkItemUpsertInput, not an overlay-supplied node. `fence` is `{admission:{runId,leaseEpoch,agentId,nodeId},graphRunId,workflowIrHash}` from native task/context/current resolved IR. Only the native principal-before-node writer calls this method for a current released terminal.

Add `TaskStore.readWorkflowOverlayReleasedAdmission(taskId, {admission,graphRunId,workItemId,nodeInstanceId})` returning `{valid:true,terminal,release,workItem}` or `{valid:false,reason}`. This read is a native validation of the current admitted running item, not an actor authorization grant. Overlay must pass actual current work-item context, not enumerate or choose historical rows.

Inside existing sourceMetadata.currentTerminal.release add only `currentAdmittedWorkItemId` and `currentAdmittedNodeInstanceId`. No schema migration, generic payload field or history graph.

## Transactions and validation

New dedicated method in task-store/workflow-overlay-release.ts acquires task advisory lock, workflow serialization lock and task row lock in existing Reset order. Reuse replaceActiveTaskWorkflowContinuation(..., existingTx). Under those locks:

1. Require unpaused nondeleted task, exact current checkout run/epoch/agent/host, current released terminal graph/operation/admission, and unchanged selected custom IR (shared row locks as existing release).
2. Require exact predecessor = currentAdmittedWorkItemId if present, otherwise original release.successorId. It must still be active and belong to this task/release; cancelled/terminal rows refuse. Input must be running task-kind with a native principal, current graph stableWorkflowRunId and IR hash.
3. Validate actual input.nodeId/nodeInstanceId against current IR. Top-level exact node is supported. The existing top-level build-loop's direct child is supported only for the actual native `<build-loop>#<positive iteration>:<child>` materialization, bounded by configured maxIterations; no arbitrary nesting. Native engine supplies loop:active evidence, whose loop ID/iteration must agree with the materialized identity. Do not import engine into core or accept a bare run-id prefix as proof.
4. Replace predecessor and write the two-field current pointer atomically. A same-item retry verifies identical row/identity without recreation. Preserve immutable terminal/phase receipts and original successor ID.
5. Read validator checks same current lease/IR and exact running pointer row; Reset cancels that row and invalidates validation. Unrelated replacement cannot inherit release identity. Pointer may advance only through this dedicated admission seam; ordinary replacements remain unchanged.

The native engine's principal writer will populate stableWorkflowRunId and irHash and call the dedicated method when the current native task has a released terminal; failures hold before a plugin/session executes. Original release replay retains its current conservative semantics. Existing direct principal rows remain active until replaced or interpreter finalization, allowing a bounded pointer to follow only admitted replacements.

## Owned files

- packages/core/src/task-store/workflow-overlay-release.ts
- packages/core/src/store.ts (two facade methods)
- packages/engine/src/executor/workflow-principal-before-node.ts (native routing writer only)
- packages/engine/src/__tests__/workflow-overlay-release-principal.pg.test.ts
- existing core release PG tests only where needed for Reset/race assertions
- narrow changeset and this report

No changes to Reset, generic replacement default behavior, Board, plugin mapping, actor endpoint or schema. Transaction reuse stays existingTx-only.

## Test acceptance

Red test: real A4, release, then actual admitWorkflowPrincipalBeforeNode creates current running row; old release replay remains refused but the new exact current-row validator must succeed. Run against isolated PG; no inference.

Additional tests: two principal replacements retain only current pointer and reject old row; changed lease/agent/host/IR/materialized loop ancestry refuses; Reset before/after handoff cancels authority; injected pointer-write failure rolls back both replacement and pointer; terminal old row cannot be recreated. Native actual loop interpreter must produce the child identity used by the test. Overlay accepted-phase consumption stays a separate pending integration test, not implied by these native tests.

## Approved execution refinements

Parent approved one additional owned file: packages/engine/src/executor/execute-workflow-graph.ts. Its existing continuation context now carries actual workflow:resumed-work-item-id even when the selected successor has no principal yet. A small production helper builds that context; tests consume it before actual principal admission. The field advances only to a work item returned by the native handoff. Retained metadata without a matching actual continuation never activates this seam.

Physical principal run IDs are deterministic release-specific hashes; stableWorkflowRunId remains the actual graph. This avoids the pre-release principal's terminal graph/node key and preserves that row. Exact current-pointer retries return the existing row without an additional audit; projection failure recovers from the actual selected admitted row, while obsolete predecessor requests remain refused.

Final applicability refinement: the dedicated transaction classifies the actual resumed/current native row against the exact deterministic release-specific run key and stable graph, not a string prefix or retained metadata. A related old row refuses even after the pointer advances. Only a positively unrelated native row returns not-applicable and permits normal admission. No additional context field/history table was needed. Request task identity is owned before the first await.
