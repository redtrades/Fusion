import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as persistence from "../../task-store/async/async-persistence.js";
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
    expect(JSON.parse(await readFile(join(store.taskDir(t.id), "task.json"), "utf8")).sourceMetadata?.procedureEngineLive).toMatchObject({ runs: { "graph-a": input.nextState } });
  });
  // FNXC:WorkflowOverlay 2026-09-14-02:09: Any committed row mutation supersedes terminal acknowledgement; cleanup cannot overwrite that writer or replay lifecycle dispatch.
  it("refuses replay after an ordinary writer changes the row before postcommit cleanup", async () => {
    const t = await task(); const store = h.store();
    const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
    const original = store.writeTaskJsonFile;
    let interleaved = false; let moveEvents = 0;
    const onMove = () => { moveEvents += 1; };
    store.on("task:moved", onMove);
    store.writeTaskJsonFile = async (...args) => {
      await original.apply(store, args);
      if (interleaved) return;
      interleaved = true;
      await other.updateTask(t.id, { sourceMetadataPatch: { ordinaryWriter: "preserve-me" } });
    };
    try {
      await expect(store.applyWorkflowOverlayTerminalFenced(t.id, request())).resolves.toMatchObject({ applied: true });
      expect(interleaved).toBe(true);
      const before = await h.adminSql()`SELECT source_metadata, transition_pending, xmin::text AS revision FROM project.tasks WHERE id = ${t.id}`;
      const metadata = before[0].source_metadata;
      expect(metadata.ordinaryWriter).toBe("preserve-me");
      expect(metadata.procedureEngineLive.runs["graph-a"].writeFence.terminal.rowRevision).not.toBe(before[0].revision);
      expect(before[0].transition_pending).not.toBeNull();
      const audits = await h.adminSql()`SELECT count(*)::int AS n FROM project.run_audit_events WHERE mutation_type = 'task:move'`;
      expect(moveEvents).toBe(1);
      await expect(store.applyWorkflowOverlayTerminalFenced(t.id, request())).resolves.toEqual({ applied: false, reason: "transition-superseded" });
      const after = await h.adminSql()`SELECT source_metadata, transition_pending, xmin::text AS revision FROM project.tasks WHERE id = ${t.id}`;
      expect(after).toEqual(before);
      expect(moveEvents).toBe(1);
      expect(await h.adminSql()`SELECT count(*)::int AS n FROM project.run_audit_events WHERE mutation_type = 'task:move'`).toEqual(audits);
    } finally { store.writeTaskJsonFile = original; store.off("task:moved", onMove); }
  });
  // FNXC:WorkflowOverlay 2026-09-14-02:09: A real nested PostgreSQL transaction gives the upsert a child xmin; the native guard must roll back metadata and column rather than trust the parent xid.
  it("rolls back a terminal upsert whose actual xmin belongs to a subtransaction", async () => {
    const t = await task(); const original = persistence.upsertTaskRowInTransaction;
    let parentRevision: string | undefined; let writtenRevision: string | undefined;
    const spy = vi.spyOn(persistence, "upsertTaskRowInTransaction").mockImplementation(async (tx, record, context, projectId) => {
      const parent = await tx.execute(sql`SELECT (txid_current() % 4294967296)::text AS revision`);
      parentRevision = String(parent[0].revision);
      await tx.transaction(async child => {
        await original(child, record, context, projectId);
        const written = await child.execute(sql`SELECT xmin::text AS revision FROM project.tasks WHERE id = ${t.id}`);
        writtenRevision = String(written[0].revision);
      });
    });
    try {
      await expect(h.store().applyWorkflowOverlayTerminalFenced(t.id, request())).resolves.toEqual({ applied: false, reason: "transition-superseded" });
      expect(parentRevision).toBeDefined(); expect(writtenRevision).toBeDefined();
      expect(writtenRevision).not.toBe(parentRevision);
      const unchanged = await h.store().getTask(t.id);
      expect(unchanged.column).toBe("todo"); expect(unchanged.sourceMetadata?.procedureEngineLive).toBeUndefined();
      const rows = await h.adminSql()`SELECT transition_pending FROM project.tasks WHERE id = ${t.id}`;
      expect(rows[0].transition_pending).toBeNull();
      const audits = await h.adminSql()`SELECT count(*)::int AS n FROM project.run_audit_events WHERE mutation_type = 'task:move'`;
      expect(audits[0].n).toBe(0);
    } finally { spy.mockRestore(); }
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
