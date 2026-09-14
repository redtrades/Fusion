import * as persistence from "../../task-store/async/async-persistence.js";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createSharedPgTaskStoreTestHarness, pgDescribe } from "../../__test-utils__/pg-test-harness.js";
import { TaskStore } from "../../store.js";
import type { WorkflowOverlayCurrentTerminal } from "../../task-store/workflow-overlay-release.js";

pgDescribe("native held terminal release", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_overlay_release", projectId: "proj-overlay-release", poolMax: 4 });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterAll(h.afterAll);
  const admission = { runId: "checkout-old", leaseEpoch: 1, agentId: "agent", nodeId: "host" };
  const currentAdmission = { ...admission, runId: "checkout-new", leaseEpoch: 2 };
  async function claim(id: string, a = currentAdmission) {
    await h.store().updateTask(id, { checkedOutBy: a.agentId, checkoutNodeId: a.nodeId, checkoutRunId: a.runId, checkoutLeaseEpoch: a.leaseEpoch });
  }
  async function fixture(blockingNodeId = "builder") {
    const store = h.store();
    const definition = await store.createWorkflowDefinition({ name: "release", layout: {}, ir: { version: "v2", name: "release",
      columns: [{ id: "in-progress", name: "WIP", traits: [{ trait: "wip" }] }],
      nodes: [{ id: "start", kind: "start", column: "in-progress" }, { id: "builder", kind: "agent", column: "in-progress", config: {} }, { id: "end", kind: "end", column: "in-progress" }],
      edges: [{ from: "start", to: "builder", condition: "success" }, { from: "builder", to: "end", condition: "success" }] } });
    const task = await store.createTask({ description: "release fixture", workflowId: definition.id });
    await claim(task.id, admission);
    const original = await store.replaceActiveTaskWorkflowContinuation({ taskId: task.id, runId: "original", nodeId: "builder", kind: "task", state: "running" });
    const request = { admission, expectedPhaseCount: 0, expectedColumn: task.column, targetColumn: task.column, operationId: "terminal",
      nextState: { runId: "graph", claimId: "claim", occurrence: 0, phaseCount: 1, previousEnvelope: null, reviewedHeadOid: null,
        receipts: [{ terminalBlock: { reason: "missing-input", blockingNodeId, resumeActor: "orchestrator" } }] } };
    expect(await store.applyWorkflowOverlayTerminalFenced(task.id, request)).toMatchObject({ applied: true });
    const persisted = await store.getTask(task.id);
    const anchor = (persisted.sourceMetadata!.procedureEngineLive as { currentTerminal: WorkflowOverlayCurrentTerminal }).currentTerminal;
    expect(await store.readWorkflowOverlayCurrentTerminal(task.id)).toMatchObject({ current: !!anchor });
    const release = { expectedTerminalOperationId: "terminal", expectedGraphRunId: "graph", releaseOperationId: "release", admission: currentAdmission, expectedWorkflowIrHash: anchor?.workflowIrHash ?? "absent" };
    return { task, original, anchor, release, request, definition };
  }
  it("holds a distinct anchor, admits new checkout, rejects old writer, and replays without resurrection", async () => {
    const { task, original, anchor, release } = await fixture();
    expect((await h.store().getWorkflowWorkItem(original.id))?.state).toBe("succeeded");
    expect((await h.store().getWorkflowWorkItem(anchor.heldWorkItemId))?.state).toBe("held");
    // Original graph close catches this terminal transition failure; the new anchor remains held.
    await expect(h.store().transitionWorkflowWorkItem(original.id, "failed")).rejects.toThrow();
    expect((await h.store().getWorkflowWorkItem(anchor.heldWorkItemId))?.state).toBe("held");
    await claim(task.id);
    expect(await h.store().readWorkflowOverlayCurrentTerminal(task.id)).toMatchObject({ current: true });
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(task.id, { ...release, admission })).toMatchObject({ applied: false, reason: "ownership-mismatch" });
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(task.id, { ...release, expectedGraphRunId: "old-graph" })).toMatchObject({ applied: false, reason: "terminal-superseded" });
    const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
    const results = await Promise.all([h.store().releaseWorkflowOverlayTerminalFenced(task.id, release), other.releaseWorkflowOverlayTerminalFenced(task.id, release)]);
    expect(results.every(r => r.applied)).toBe(true);
    const first = results[0]; if (!first.applied) throw new Error("release refused");
    expect(results.filter(r => r.applied && r.replayed).length).toBe(1);
    expect((await h.store().getTask(task.id)).paused).not.toBe(true);
    expect((await h.store().getWorkflowWorkItem(anchor.heldWorkItemId))?.state).toBe("succeeded");
    await h.store().transitionWorkflowWorkItem(first.successor.id, "succeeded");
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(task.id, release)).toMatchObject({ applied: false, reason: "terminal-superseded" });
    expect((await h.store().getWorkflowWorkItem(first.successor.id))?.state).toBe("succeeded");
  });
  it.each([false, true])("Reset invalidates authority after release=%s even with matching restored pause and a new checkout", async (released) => {
    const { task, anchor, release } = await fixture(); await claim(task.id);
    if (released) expect(await h.store().releaseWorkflowOverlayTerminalFenced(task.id, release)).toMatchObject({ applied: true });
    await h.store().resetTaskPublication(task.id, task.column);
    await claim(task.id);
    await h.store().updateTask(task.id, { paused: true, status: "paused", pausedReason: "missing-input", error: "missing-input" });
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(task.id, release)).toMatchObject({ applied: false, reason: "terminal-superseded" });
    expect(await h.store().readWorkflowOverlayCurrentTerminal(task.id)).toEqual({ current: false });
    if (!released) expect((await h.store().getWorkflowWorkItem(anchor.heldWorkItemId))?.state).toBe("cancelled");
  });
  it("rolls successor publication back when the task row write fails, then retries once", async () => {
    const { task, anchor, release } = await fixture(); await claim(task.id);
    await h.adminSql().unsafe(`CREATE FUNCTION project.reject_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.paused AND NOT NEW.paused THEN RAISE EXCEPTION 'release test refusal'; END IF; RETURN NEW; END $$`);
    await h.adminSql().unsafe(`CREATE TRIGGER reject_release BEFORE UPDATE ON project.tasks FOR EACH ROW EXECUTE FUNCTION project.reject_release()`);
    try { await expect(h.store().releaseWorkflowOverlayTerminalFenced(task.id, release)).rejects.toThrow(); }
    finally { await h.adminSql().unsafe("DROP TRIGGER reject_release ON project.tasks"); await h.adminSql().unsafe("DROP FUNCTION project.reject_release()"); }
    expect((await h.store().getTask(task.id)).paused).toBe(true);
    expect((await h.store().getWorkflowWorkItem(anchor.heldWorkItemId))?.state).toBe("held");
    const items = await h.store().listWorkflowWorkItemsForTask(task.id);
    expect(items.filter(item => item.runId.startsWith("overlay-release:")).length).toBe(0);
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(task.id, release)).toMatchObject({ applied: true, replayed: false });
  });
  it("refuses unsupported binding and mismatched IR without clearing suspension", async () => {
    const unsupported = await fixture("nested:builder"); await claim(unsupported.task.id);
    expect(unsupported.anchor).toBeNull();
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(unsupported.task.id, unsupported.release)).toMatchObject({ applied: false });
    const valid = await fixture(); await claim(valid.task.id);
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(valid.task.id, { ...valid.release, expectedWorkflowIrHash: "changed" })).toMatchObject({ applied: false, reason: "workflow-mismatch" });
    await h.store().updateWorkflowDefinition(valid.definition.id, { ir: { ...valid.definition.ir, name: "edited-ir" } });
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(valid.task.id, valid.release)).toMatchObject({ applied: false, reason: "workflow-mismatch" });
    expect(await h.store().readWorkflowOverlayCurrentTerminal(valid.task.id)).toEqual({ current: false });
    expect((await h.store().getTask(valid.task.id)).paused).toBe(true);
  });
  it("refuses wrong agent/host and new-lease replay; repairs a failed postcommit projection without duplicate publication", async () => {
    const { task, release } = await fixture(); await claim(task.id);
    for (const patch of [{ agentId: "other" }, { nodeId: "other" }]) {
      expect(await h.store().releaseWorkflowOverlayTerminalFenced(task.id, { ...release, admission: { ...currentAdmission, ...patch } }))
        .toMatchObject({ applied: false, reason: "ownership-mismatch" });
    }
    const projection = vi.spyOn(h.store(), "writeTaskJsonFile").mockRejectedValueOnce(new Error("fixture projection failure"));
    await expect(h.store().releaseWorkflowOverlayTerminalFenced(task.id, release)).rejects.toThrow("fixture projection failure");
    expect((await h.store().getTask(task.id)).paused).not.toBe(true);
    const result = await h.store().releaseWorkflowOverlayTerminalFenced(task.id, release);
    expect(result).toMatchObject({ applied: true, replayed: true });
    expect(projection).toHaveBeenCalledTimes(2); projection.mockRestore();
    expect((await h.store().listWorkflowWorkItemsForTask(task.id)).filter(item => item.runId.startsWith("overlay-release:")).length).toBe(1);
    const newer = { ...currentAdmission, leaseEpoch: 3, runId: "checkout-newest" }; await claim(task.id, newer);
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(task.id, release)).toMatchObject({ applied: false, reason: "ownership-mismatch" });
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(task.id, { ...release, admission: newer })).toMatchObject({ applied: false, reason: "terminal-superseded" });
  });
  it.each(["release", "reset"])("serializes concurrent %s first with Reset without resurrecting work", async (first) => {
    const { task, anchor, release } = await fixture(); await claim(task.id);
    const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
    let entered!: () => void, proceed!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const proceedPromise = new Promise<void>(resolve => { proceed = resolve; });
    const original = persistence.upsertTaskRowInTransaction;
    const spy = vi.spyOn(persistence, "upsertTaskRowInTransaction").mockImplementationOnce(async (...args) => {
      entered(); await proceedPromise; return original(...args);
    });
    const releaseCall = () => h.store().releaseWorkflowOverlayTerminalFenced(task.id, release);
    const resetCall = () => other.resetTaskPublication(task.id, task.column);
    const firstCall = first === "release" ? releaseCall() : resetCall();
    await enteredPromise;
    const secondCall = first === "release" ? resetCall() : releaseCall();
    proceed();
    try { await Promise.all([firstCall, secondCall]); } finally { spy.mockRestore(); }
    expect(await h.store().readWorkflowOverlayCurrentTerminal(task.id)).toEqual({ current: false });
    const items = await h.store().listWorkflowWorkItemsForTask(task.id);
    expect(items.filter(item => ["held", "runnable", "running", "retrying"].includes(item.state))).toEqual([]);
    expect((await h.store().getWorkflowWorkItem(anchor.heldWorkItemId))?.state).not.toBe("held");
    await claim(task.id);
    expect(await h.store().releaseWorkflowOverlayTerminalFenced(task.id, release)).toMatchObject({ applied: false });
  });

});
