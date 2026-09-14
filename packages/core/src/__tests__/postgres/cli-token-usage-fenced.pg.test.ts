import { __setResetPublicationFailureForTesting } from "../../task-store/reset-lifecycle.js";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { pgDescribe, createSharedPgTaskStoreTestHarness } from "../../__test-utils__/pg-test-harness.js";
import { CliSessionStore } from "../../cli/cli-session-store.js";
import { TaskStore } from "../../store.js";
import type { CliTokenUsageWrite } from "../../task-store/cli-token-usage-ops.js";
pgDescribe("native CLI durable token accounting", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_cli_tokens", poolMax: 4, projectId: "project-cli-tokens" });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterAll(h.afterAll);
  const admission = { runId: "run", leaseEpoch: 1, agentId: "agent", nodeId: "host" };
  async function fixture() {
    const task = await h.store().createTask({ description: "CLI token accounting" });
    await h.store().updateTask(task.id, { checkoutRunId: admission.runId, checkoutLeaseEpoch: 1, checkedOutBy: admission.agentId, checkoutNodeId: admission.nodeId, sourceMetadataPatch: { unrelated: true } });
    const sessions = await CliSessionStore.create(h.layer(), "project-cli-tokens");
    const session = sessions.createSession({ projectId: "project-cli-tokens", taskId: task.id, adapterId: "codex", nativeSessionId: "conversation", purpose: "execute" }); await sessions.flush();
    const request = (count: number): CliTokenUsageWrite => ({ sessionId: session.id, nativeSessionId: "conversation", projectId: "project-cli-tokens", admission, baseline: false, observations: [{ key: "cumulative", usage: { inputTokens: count, outputTokens: 0, cachedTokens: 1000, cacheWriteTokens: 0 } }], cursor: { bytes: 100, fileIdentity: "1:2", phase: "observing" }, limits: { hard: 20 } });
    return { task, sessions, request };
  }
  it("commits aggregate/checkpoint together across two store instances and pauses on observed crossing", async () => {
    const f = await fixture(); const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
    await Promise.all([h.store().recordCliTokenUsageFenced(f.task.id, f.request(10)), other.recordCliTokenUsageFenced(f.task.id, f.request(10))]);
    expect((await h.store().getTask(f.task.id)).tokenUsage?.inputTokens).toBe(10);
    const ack = await other.recordCliTokenUsageFenced(f.task.id, f.request(21));
    expect(ack).toMatchObject({ hardExceeded: true, observedWorkTokens: 21, task: { paused: true, pausedReason: "token_budget_exceeded", sourceMetadata: { unrelated: true } } });
    expect(ack.task.tokenUsage?.inputTokens).toBe(21);
    const native = f.sessions.createSession({ projectId: "project-cli-tokens", taskId: f.task.id, adapterId: "codex", nativeSessionId: "conversation-2", purpose: "execute" }); await f.sessions.flush();
    const next = { ...f.request(3), sessionId: native.id, nativeSessionId: "conversation-2" };
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, next)).observedWorkTokens).toBe(24);
  });
  it("waits behind Reset and then refuses the cleared admission", async () => {
    const f = await fixture();
    let entered!: () => void; const held = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const restore = __setResetPublicationFailureForTesting(async () => { entered(); await gate; });
    try {
      const reset = h.store().resetTaskPublication(f.task.id, "todo"); await held;
      const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
      const late = other.recordCliTokenUsageFenced(f.task.id, f.request(3));
      const refused = expect(late).rejects.toThrow("ownership");
      await expect.poll(async () => {
        const rows = await h.adminSql()`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`;
        return rows[0].n;
      }, { timeout: 1000, interval: 10 }).toBe(1);
      release(); await reset; await refused;
      expect((await h.store().getTask(f.task.id)).tokenUsage).toBeUndefined();
    } finally { release(); restore(); }
  });
  it("refuses a stale lease, wrong native/project identity, and post-Reset writes", async () => {
    const f = await fixture();
    for (const bad of [{ ...f.request(1), projectId: "other" }, { ...f.request(1), nativeSessionId: "other" }, { ...f.request(1), admission: { ...admission, leaseEpoch: 2 } }]) await expect(h.store().recordCliTokenUsageFenced(f.task.id, bad)).rejects.toThrow();
    expect((await h.store().getTask(f.task.id)).tokenUsage).toBeUndefined();
    await h.store().resetTaskPublication(f.task.id, "todo");
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, f.request(5))).rejects.toThrow("ownership");
  });
  it("fences fresh pending admission, binds the first inode once, and charges first cumulative usage", async () => {
    const f = await fixture();
    const pending: CliTokenUsageWrite = { ...f.request(0), fresh: true, observations: [], cursor: { bytes: 0, phase: "awaiting-file", transcriptPath: "/native/future.jsonl" } };
    const admitted = await h.store().recordCliTokenUsageFenced(f.task.id, pending);
    expect(admitted.observedWorkTokens).toBe(0);
    expect(admitted.task.sourceMetadata?.cliTokenUsage).toMatchObject({ cursors: { "codex:conversation": { phase: "awaiting-file", transcriptPath: "/native/future.jsonl" } } });
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, pending)).rejects.toThrow("fresh");
    const bound: CliTokenUsageWrite = { ...f.request(9), cursor: { ...f.request(9).cursor, transcriptPath: "/native/future.jsonl" } };
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, bound)).observedWorkTokens).toBe(9);
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, bound)).observedWorkTokens).toBe(9);
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, { ...bound, cursor: { ...bound.cursor, fileIdentity: "other" } })).rejects.toThrow("identity");
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, { ...bound, cursor: { ...bound.cursor, transcriptPath: "/other/path" } })).rejects.toThrow("identity");
    await h.store().resetTaskPublication(f.task.id, "todo");
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, pending)).rejects.toThrow("ownership");
  });

  it("reaffirms only the exact pending ownership and observes concurrent budget exhaustion", async () => {
    const f = await fixture();
    const pending: CliTokenUsageWrite = { ...f.request(0), fresh: true, observations: [], cursor: { bytes: 0, phase: "awaiting-file", transcriptPath: "/native/future.jsonl" } };
    await h.store().recordCliTokenUsageFenced(f.task.id, pending);
    const { fresh: _fresh, ...previous } = pending;
    const reaffirm = { ...previous, reaffirm: true as const };
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, reaffirm)).observedWorkTokens).toBe(0);
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, { ...reaffirm, cursor: { ...reaffirm.cursor, transcriptPath: "/wrong/path" } })).rejects.toThrow();
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, pending)).rejects.toThrow("fresh");
    const native = f.sessions.createSession({ projectId: "project-cli-tokens", taskId: f.task.id, adapterId: "codex", nativeSessionId: "concurrent", purpose: "execute" }); await f.sessions.flush();
    await h.store().recordCliTokenUsageFenced(f.task.id, { ...f.request(21), sessionId: native.id, nativeSessionId: "concurrent" });
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, reaffirm)).hardExceeded).toBe(true);
    await h.store().resetTaskPublication(f.task.id, "todo");
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, reaffirm)).rejects.toThrow("ownership");
  });

});
