import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { TaskStore } from "../../store.js";
import { __setResetPublicationFailureForTesting } from "../../task-store/reset-lifecycle.js";
import { pgDescribe, createSharedPgTaskStoreTestHarness } from "../../__test-utils__/pg-test-harness.js";

pgDescribe("workflow overlay checkpoint fencing", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_overlay_fence", poolMax: 4, projectId: "proj-overlay-fixture" });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterEach(() => vi.restoreAllMocks()); afterAll(h.afterAll);
  const admission = { runId: "run-a", leaseEpoch: 1, agentId: "agent-a", nodeId: "host-a" };
  const request = () => ({ admission, expectedPhaseCount: 0, operationId: "phase-a",
    nextState: { runId: "graph-a", claimId: "claim-a", occurrence: 1, phaseCount: 1, previousEnvelope: { phase_id: "validator:1" }, reviewedHeadOid: null,
      receipts: [{ nodeInstanceId: "validator:1", provenance: { sessionId: "session-a" } }] } });
  async function task() {
    const t = await h.store().createTask({ description: "overlay CAS fixture" });
    await h.store().updateTask(t.id, { checkedOutBy: admission.agentId, checkoutNodeId: admission.nodeId,
      checkoutRunId: admission.runId, checkoutLeaseEpoch: admission.leaseEpoch, sourceMetadataPatch: { unrelated: { keep: true } } });
    return t;
  }
  it("persists one receipt without changing unrelated metadata or task fields and replays exactly", async () => {
    const t = await task(); const input = request();
    const ack = await h.store().updateWorkflowOverlayStateFenced(t.id, input);
    expect(ack).toMatchObject({ applied: true, replayed: false, state: input.nextState });
    expect((await h.store().getTask(t.id)).sourceMetadata).toMatchObject({ unrelated: { keep: true }, procedureEngineLive: { runs: { "graph-a": input.nextState } } });
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, input)).resolves.toMatchObject({ applied: true, replayed: true, state: input.nextState });
    expect((await h.store().getTask(t.id)).column).toBe(t.column);
    input.nextState.receipts[0].provenance.sessionId = "different-session";
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, input)).resolves.toMatchObject({ applied: false });
  });
  it("appends a subsequent phase and recovers an acknowledged database write after projection failure", async () => {
    const t = await task();
    const store = h.store();
    vi.spyOn(store, "isWatching", "get").mockReturnValue(true);
    store.taskCache.set(t.id, t);
    const original = store.writeTaskJsonFile;
    store.writeTaskJsonFile = async () => { throw new Error("fixture projection unavailable"); };
    try { await expect(store.updateWorkflowOverlayStateFenced(t.id, request())).rejects.toThrow("fixture projection unavailable"); }
    finally { store.writeTaskJsonFile = original; }
    expect((await store.getTask(t.id)).sourceMetadata?.procedureEngineLive).toBeDefined();
    expect(JSON.parse(await readFile(join(store.taskDir(t.id), "task.json"), "utf8")).sourceMetadata?.procedureEngineLive).toBeUndefined();
    await expect(store.updateWorkflowOverlayStateFenced(t.id, request())).resolves.toMatchObject({ applied: true, replayed: true });
    expect(JSON.parse(await readFile(join(store.taskDir(t.id), "task.json"), "utf8")).sourceMetadata?.procedureEngineLive).toMatchObject({ runs: { "graph-a": request().nextState } });
    expect(store.taskCache.get(t.id)?.sourceMetadata?.procedureEngineLive).toMatchObject({ runs: { "graph-a": request().nextState } });
    const next = { ...request(), operationId: "phase-b", expectedPhaseCount: 1,
      nextState: { ...request().nextState, phaseCount: 2,
        receipts: [...request().nextState.receipts, { nodeInstanceId: "builder:1" }] } };
    await expect(store.updateWorkflowOverlayStateFenced(t.id, next)).resolves.toMatchObject({ applied: true, state: next.nextState });
    expect((await store.getTask(t.id)).sourceMetadata?.procedureEngineLive).toMatchObject({ runs: { "graph-a": next.nextState } });
  });
  it("rejects lossy or oversized data, foreign state fields, phase overflow, and an unavailable backend", async () => {
    const t = await task(); const store = h.store();
    for (const input of [
      { ...request(), nextState: { ...request().nextState, extra: "not admitted" } },
      { ...request(), nextState: { ...request().nextState, previousEnvelope: { absent: undefined } } },
      { ...request(), nextState: { ...request().nextState, previousEnvelope: { large: "x".repeat(1024 * 1024) } } },
      { ...request(), expectedPhaseCount: 256, nextState: { ...request().nextState, phaseCount: 257 } },
    ]) await expect(store.updateWorkflowOverlayStateFenced(t.id, input)).resolves.toEqual({ applied: false, reason: "invalid-input" });
    const unbound = new TaskStore(h.rootDir());
    await expect(unbound.updateWorkflowOverlayStateFenced(t.id, request())).resolves.toEqual({ applied: false, reason: "unavailable" });
  });
  it("permits equal graph and checkout ID strings and null envelopes across rejected phases", async () => {
    const t = await task();
    const first = { ...request(), nextState: { ...request().nextState, runId: admission.runId, previousEnvelope: null, occurrence: 0 } };
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, first)).resolves.toMatchObject({ applied: true });
    const next = { ...first, operationId: "rejected-phase-b", expectedPhaseCount: 1,
      nextState: { ...first.nextState, phaseCount: 2, receipts: [...first.nextState.receipts, { nodeInstanceId: "builder:1", outcome: "rejected" }] } };
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, next)).resolves.toMatchObject({ applied: true, state: { previousEnvelope: null, occurrence: 0 } });
  });
  it("two store instances competing at the same revision produce one winner", async () => {
    const t = await task();
    const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
    const results = await Promise.all([h.store().updateWorkflowOverlayStateFenced(t.id, request()),
      other.updateWorkflowOverlayStateFenced(t.id, { ...request(), operationId: "competitor" })]);
    expect(results.filter(r => r.applied)).toHaveLength(1);
    expect((await h.store().getTask(t.id)).sourceMetadata?.procedureEngineLive).toMatchObject({ runs: { "graph-a": { phaseCount: 1 } } });
  });
  it("rejects old lease owners even for an otherwise idempotent replay", async () => {
    const t = await task(); await h.store().updateWorkflowOverlayStateFenced(t.id, request());
    await h.store().updateTask(t.id, { checkoutLeaseEpoch: 2 });
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, request())).resolves.toEqual({ applied: false, reason: "ownership-mismatch" });
  });
  it("keeps historical runs through Reset and permits only the newly admitted run", async () => {
    const t = await task(); await h.store().updateWorkflowOverlayStateFenced(t.id, request());
    await h.store().resetTaskPublication(t.id, "todo");
    const replacement = { ...admission, runId: "run-b", leaseEpoch: 2 };
    await h.store().updateTask(t.id, { checkedOutBy: replacement.agentId, checkoutNodeId: replacement.nodeId,
      checkoutRunId: replacement.runId, checkoutLeaseEpoch: replacement.leaseEpoch });
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, request())).resolves.toMatchObject({ applied: false, reason: "ownership-mismatch" });
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, { ...request(), admission: replacement, nextState: { ...request().nextState, runId: "graph-b" } })).resolves.toMatchObject({ applied: true, replayed: false });
    expect((await h.store().getTask(t.id)).sourceMetadata?.procedureEngineLive).toMatchObject({ runs: { "graph-a": request().nextState, "graph-b": { ...request().nextState, runId: "graph-b" } } });
  });
  it("allows a valid same-run lease takeover to replay and append without rewriting historical provenance", async () => {
    const t = await task(); await h.store().updateWorkflowOverlayStateFenced(t.id, request());
    const replacement = { ...admission, leaseEpoch: 2, agentId: "agent-b", nodeId: "host-b" };
    await h.store().updateTask(t.id, { checkedOutBy: replacement.agentId, checkoutNodeId: replacement.nodeId, checkoutLeaseEpoch: replacement.leaseEpoch });
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, request())).resolves.toMatchObject({ applied: false });
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, { ...request(), admission: replacement })).resolves.toMatchObject({ applied: true, replayed: true });
    const next = { ...request(), admission: replacement, expectedPhaseCount: 1, operationId: "phase-b",
      nextState: { ...request().nextState, phaseCount: 2, receipts: [...request().nextState.receipts, { nodeInstanceId: "builder:1" }] } };
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, next)).resolves.toMatchObject({ applied: true, state: next.nextState });
  });
  it("keeps two graph runs separate under one checkout and refuses changed claims", async () => {
    const t = await task();
    await h.store().updateWorkflowOverlayStateFenced(t.id, request());
    const second = { ...request(), nextState: { ...request().nextState, runId: "graph-b", claimId: "claim-b" } };
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, second)).resolves.toMatchObject({ applied: true, replayed: false });
    const state = (await h.store().getTask(t.id)).sourceMetadata?.procedureEngineLive;
    expect(state).toMatchObject({ runs: { "graph-a": request().nextState, "graph-b": second.nextState } });
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, { ...request(), nextState: { ...request().nextState, claimId: "changed" } })).resolves.toMatchObject({ applied: false });
  });
  it("waits behind Reset and refuses the cleared lease instead of restoring a checkpoint", async () => {
    const t = await task();
    let entered!: () => void; const held = new Promise<void>(r => { entered = r; });
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const restore = __setResetPublicationFailureForTesting(async () => { entered(); await gate; });
    try {
      const reset = h.store().resetTaskPublication(t.id, "todo"); await held;
      const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
      const late = other.updateWorkflowOverlayStateFenced(t.id, request());
      await expect.poll(async () => {
        const rows = await h.adminSql()`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event = 'advisory'`;
        return rows[0].n;
      }, { timeout: 1000, interval: 10 }).toBe(1);
      release(); await reset;
      await expect(late).resolves.toEqual({ applied: false, reason: "ownership-mismatch" });
      expect((await h.store().getTask(t.id)).sourceMetadata?.procedureEngineLive).toBeUndefined();
    } finally { release(); restore(); }
  });
  it("refuses missing and deleted rows", async () => {
    await expect(h.store().updateWorkflowOverlayStateFenced("missing", request())).resolves.toEqual({ applied: false, reason: "task-missing" });
    const t = await task(); await h.adminSql().unsafe('UPDATE project.tasks SET deleted_at = now() WHERE id = $1', [t.id]);
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, request())).resolves.toEqual({ applied: false, reason: "task-deleted" });
  });
  it("rejects a rewritten receipt prefix, malformed state, and an unbound host", async () => {
    const t = await task(); await h.store().updateWorkflowOverlayStateFenced(t.id, request());
    const next = { ...request(), operationId: "phase-b", expectedPhaseCount: 1,
      nextState: { ...request().nextState, phaseCount: 2, receipts: [{ nodeInstanceId: "replacement" }, { nodeInstanceId: "new" }] } };
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, next)).resolves.toMatchObject({ applied: false });
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, { ...request(), admission: { ...admission, nodeId: "other" } })).resolves.toMatchObject({ applied: false });
    await expect(h.store().updateWorkflowOverlayStateFenced(t.id, { ...request(), nextState: { ...request().nextState, phaseCount: 42 } })).resolves.toMatchObject({ applied: false });
  });
});
