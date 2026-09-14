import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { TaskStore } from "../../store.js";
import { pgDescribe, createSharedPgTaskStoreTestHarness } from "../../__test-utils__/pg-test-harness.js";

pgDescribe("workflow overlay terminal transition", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_overlay_terminal", projectId: "proj-overlay-terminal", poolMax: 4 });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterAll(h.afterAll);
  const admission = { runId: "checkout-a", leaseEpoch: 1, agentId: "agent-a", nodeId: "host-a" };
  const request = () => ({ admission, expectedPhaseCount: 0, expectedColumn: "todo", targetColumn: "in-progress", operationId: "terminal-a",
    nextState: { runId: "graph-a", claimId: "claim-a", occurrence: 0, phaseCount: 1, previousEnvelope: null, reviewedHeadOid: null,
      receipts: [{ nodeInstanceId: "blocked-sink:1", terminal: { reason: "missing-input", blockingNodeId: "builder", resumeActor: "orchestrator", blockedAt: "2026-09-14T01:26:00Z", envelopeDigests: [] } }] } });
  async function task() {
    const t = await h.store().createTask({ description: "atomic terminal fixture" });
    await h.store().updateTask(t.id, { checkedOutBy: admission.agentId, checkoutNodeId: admission.nodeId,
      checkoutRunId: admission.runId, checkoutLeaseEpoch: admission.leaseEpoch });
    return t;
  }
  it("commits checkpoint and lifecycle move together and replays without another move audit", async () => {
    const t = await task();
    await expect(h.store().applyWorkflowOverlayTerminalFenced(t.id, request())).resolves.toMatchObject({ applied: true, replayed: false });
    const moved = await h.store().getTask(t.id);
    expect(moved.column).toBe("in-progress");
    expect(moved.sourceMetadata?.procedureEngineLive).toMatchObject({ runs: { "graph-a": request().nextState } });
    const before = await h.adminSql()`SELECT count(*)::int AS n FROM project.run_audit_events WHERE mutation_type = 'task:move'`;
    await expect(h.store().applyWorkflowOverlayTerminalFenced(t.id, request())).resolves.toMatchObject({ applied: true, replayed: true });
    const after = await h.adminSql()`SELECT count(*)::int AS n FROM project.run_audit_events WHERE mutation_type = 'task:move'`;
    expect(after[0].n).toBe(before[0].n);
  });
  it("rolls back both metadata and column when the native transactional audit fails", async () => {
    const t = await task();
    await h.adminSql().unsafe(`CREATE FUNCTION project.reject_overlay_move() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.mutation_type = 'task:move' THEN RAISE EXCEPTION 'fixture audit rejection'; END IF; RETURN NEW; END $$`);
    await h.adminSql().unsafe(`CREATE TRIGGER reject_overlay_move BEFORE INSERT ON project.run_audit_events FOR EACH ROW EXECUTE FUNCTION project.reject_overlay_move()`);
    try {
      await expect(h.store().applyWorkflowOverlayTerminalFenced(t.id, request())).rejects.toMatchObject({ cause: { message: "fixture audit rejection" } });
      const unchanged = await h.store().getTask(t.id);
      expect(unchanged.column).toBe("todo"); expect(unchanged.sourceMetadata?.procedureEngineLive).toBeUndefined();
    } finally {
      await h.adminSql().unsafe("DROP TRIGGER reject_overlay_move ON project.run_audit_events");
      await h.adminSql().unsafe("DROP FUNCTION project.reject_overlay_move()");
    }
  });
  it("rejects Reset supersession between preflight and the actual move transaction", async () => {
    const t = await task(); const store = h.store();
    const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
    const original = store.prepareWorkflowMovePolicyPreflight;
    store.prepareWorkflowMovePolicyPreflight = async (...args) => {
      const result = await original.apply(store, args);
      await other.resetTaskPublication(t.id, "todo");
      return result;
    };
    try { await expect(store.applyWorkflowOverlayTerminalFenced(t.id, request())).resolves.toMatchObject({ applied: false }); }
    finally { store.prepareWorkflowMovePolicyPreflight = original; }
    const reset = await store.getTask(t.id);
    expect(reset.column).toBe("todo"); expect(reset.sourceMetadata?.procedureEngineLive).toBeUndefined();
  });
  it("does not mistake an ordinary checkpoint replay for a committed terminal move", async () => {
    const t = await task(); await h.store().updateWorkflowOverlayStateFenced(t.id, request());
    await expect(h.store().applyWorkflowOverlayTerminalFenced(t.id, request())).resolves.toMatchObject({ applied: false });
    expect((await h.store().getTask(t.id)).column).toBe("todo");
  });
  it("publishes a same-column terminal receipt and recovers a lost projection acknowledgement", async () => {
    const t = await task(); const store = h.store(); const input = { ...request(), targetColumn: "todo" };
    const original = store.writeTaskJsonFile;
    store.writeTaskJsonFile = async () => { throw new Error("fixture projection failure"); };
    try { await expect(store.applyWorkflowOverlayTerminalFenced(t.id, input)).rejects.toThrow("fixture projection failure"); }
    finally { store.writeTaskJsonFile = original; }
    await expect(store.applyWorkflowOverlayTerminalFenced(t.id, input)).resolves.toMatchObject({ applied: true, replayed: true });
    expect((await store.getTask(t.id)).sourceMetadata?.procedureEngineLive).toMatchObject({ runs: { "graph-a": input.nextState } });
  });
  it("rejects stale owners and an invalid target without publishing checkpoint metadata", async () => {
    const t = await task();
    await expect(h.store().applyWorkflowOverlayTerminalFenced(t.id, { ...request(), admission: { ...admission, leaseEpoch: 0 } })).resolves.toMatchObject({ applied: false });
    await expect(h.store().applyWorkflowOverlayTerminalFenced(t.id, { ...request(), targetColumn: "not-a-column" })).rejects.toThrow();
    const current = await h.store().getTask(t.id);
    expect(current.column).toBe("todo"); expect(current.sourceMetadata?.procedureEngineLive).toBeUndefined();
  });
  it("allows only one terminal application across separate store instances", async () => {
    const t = await task(); const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
    const results = await Promise.all([h.store().applyWorkflowOverlayTerminalFenced(t.id, request()),
      other.applyWorkflowOverlayTerminalFenced(t.id, { ...request(), operationId: "competitor" })]);
    expect(results.filter(r => r.applied)).toHaveLength(1);
  });
  it("refuses replay after Reset even when the task returns to the same target column", async () => {
    const t = await task(); await h.store().applyWorkflowOverlayTerminalFenced(t.id, request());
    await h.store().resetTaskPublication(t.id, "in-progress");
    await expect(h.store().applyWorkflowOverlayTerminalFenced(t.id, request())).resolves.toMatchObject({ applied: false });
  });
});
