import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import "./executor-test-helpers.js";
import { resetExecutorMocks } from "./executor-test-helpers.js";
import { TaskExecutor } from "../executor.js";
import { createSharedPgTaskStoreTestHarness, pgDescribe } from "../../../core/src/__test-utils__/pg-test-harness.js";

pgDescribe("committed WIP terminal suspension through outer graph failure", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_overlay_wip_outer", projectId: "proj-overlay-wip-outer" });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); beforeEach(resetExecutorMocks);
  afterEach(h.afterEach); afterAll(h.afterAll);

  it.each(["blocked", "escalated"])("preserves %s without claiming a resume", async (column) => {
    const store = h.store();
    const workflow = await store.createWorkflowDefinition({ name: "Overlay terminal fixture", layout: {}, ir: {
      version: "v2", name: "overlay-terminal-fixture",
      columns: [
        { id: "in-progress", name: "In progress", traits: [{ trait: "wip" }] },
        { id: "blocked", name: "Blocked", traits: [{ trait: "hold", config: { release: "external-event" } }] },
        { id: "escalated", name: "Escalated", traits: [{ trait: "hold", config: { release: "manual" } }, { trait: "human-review" }] },
      ],
      nodes: [{ id: "start", kind: "start", column: "in-progress" }, { id: "end", kind: "end", column: "in-progress" },
        { id: "blocked-sink", kind: "gate", column: "blocked", config: { workflowAction: "block-sink" } },
        { id: "escalated-sink", kind: "gate", column: "escalated", config: { workflowAction: "block-sink" } }],
      edges: [{ from: "start", to: "end", condition: "success" }, { from: "start", to: "blocked-sink", condition: "outcome:blocked" },
        { from: "start", to: "escalated-sink", condition: "outcome:escalated" }],
    } });
    // A terminal disposition suspends native WIP in place; it does not move backward into a hold role.
    const task = await store.createTask({ description: "Outer terminal hold fixture", workflowId: workflow.id });
    expect(task.column).toBe("in-progress");
    const admission = { runId: "checkout-outer", leaseEpoch: 1, agentId: "agent-outer", nodeId: "host-outer" };
    await store.updateTask(task.id, { checkedOutBy: admission.agentId, checkoutNodeId: admission.nodeId,
      checkoutRunId: admission.runId, checkoutLeaseEpoch: admission.leaseEpoch });
    const terminalBlock = { reason: "missing-input", blockingNodeId: "builder", resumeActor: "orchestrator",
      blockedAt: "2026-09-14T00:00:00Z", envelopeDigests: [] };
    const terminalRequest = { admission, expectedPhaseCount: 0,
      expectedColumn: task.column, targetColumn: "in-progress", operationId: `terminal-${column}`,
      nextState: { runId: "graph-outer", claimId: "claim-outer", occurrence: 0, phaseCount: 1,
        previousEnvelope: null, reviewedHeadOid: null,
        receipts: [{ nodeInstanceId: `${column}-sink`, terminalBlock, result: { outcome: "failure", value: column } }] },
    };
    if (column === "blocked") {
      await expect(store.applyWorkflowOverlayTerminalFenced(task.id, { ...terminalRequest, targetColumn: "blocked" }))
        .rejects.toMatchObject({ rejection: { messageKey: "transition.rejected.forbiddenLifecyclePath", detail: expect.stringContaining("F5") } });
      const unchanged = await store.getTask(task.id);
      expect(unchanged.column).toBe("in-progress");
      expect(unchanged.paused).not.toBe(true);
      expect(unchanged.sourceMetadata?.procedureEngineLive).toBeUndefined();
    }
    await expect(store.applyWorkflowOverlayTerminalFenced(task.id, terminalRequest)).resolves.toMatchObject({ applied: true });
    const committed = await store.getTask(task.id);
    expect(committed).toMatchObject({ column: "in-progress", paused: true, status: "paused",
      pausedReason: "missing-input", error: "missing-input" });
    const executor = new TaskExecutor(store, h.rootDir());
    const execute = vi.spyOn(executor, "execute");
    const move = vi.spyOn(store, "moveTask");
    const resume = vi.spyOn(executor as any, "routeGraphFailureToExecutionResume");
    const remediation = vi.spyOn(executor as any, "requestPreMergeOptionalStepFix");
    await (executor as any).handleGraphFailure(task, { disposition: "failed", outcome: "failure",
      visitedNodeIds: ["earlier-review", `${column}-sink`],
      context: { "node:earlier-review:value": "review-pending", [`node:${column}-sink:value`]: column,
        terminalBlock, terminalPersistence: "native-fenced", terminalColumn: "in-progress" },
    });
    const after = await store.getTask(task.id);
    expect(after).toMatchObject({ column: "in-progress", paused: true, status: "paused",
      pausedReason: "missing-input", error: "missing-input" });
    await expect((executor as any).routeGraphFailureToExecutionResume(after, `${column}-sink`, column)).resolves.toBe(false);
    expect(after.sourceMetadata).toEqual(committed.sourceMetadata);
    expect(after.status).toBe(committed.status);
    expect(after.error).toBe(committed.error);
    expect(move).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(remediation).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalled();
    for (const result of resume.mock.results) await expect(result.value).resolves.toBe(false);
    expect(await store.getTask(task.id)).toMatchObject({ column: "in-progress", paused: true,
      status: "paused", pausedReason: "missing-input", error: "missing-input", sourceMetadata: committed.sourceMetadata });
  });
});
