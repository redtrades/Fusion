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
});
