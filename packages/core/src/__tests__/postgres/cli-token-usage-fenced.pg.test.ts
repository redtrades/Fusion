import { writeFile, appendFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { __setResetPublicationFailureForTesting } from "../../task-store/reset-lifecycle.js";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { pgDescribe, createSharedPgTaskStoreTestHarness } from "../../__test-utils__/pg-test-harness.js";
import { CliSessionStore } from "../../cli/cli-session-store.js";
import { TaskStore } from "../../store.js";
import type { CliTokenUsageWrite } from "../../task-store/cli-token-usage-ops.js";
pgDescribe("native CLI durable token accounting", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_cli_tokens", poolMax: 4, projectId: "project-cli-tokens" });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterAll(h.afterAll);
  const admission = { runId: "run", leaseEpoch: 1, agentId: "agent", nodeId: "host" };
  async function fixture(adapterId = "codex") {
    const task = await h.store().createTask({ description: "CLI token accounting" });
    await h.store().updateTask(task.id, { checkoutRunId: admission.runId, checkoutLeaseEpoch: 1, checkedOutBy: admission.agentId, checkoutNodeId: admission.nodeId, sourceMetadataPatch: { unrelated: true } });
    const sessions = await CliSessionStore.create(h.layer(), "project-cli-tokens");
    const session = sessions.createSession({ projectId: "project-cli-tokens", taskId: task.id, adapterId, nativeSessionId: "conversation", purpose: "execute" }); await sessions.flush();
    const request = (count: number): CliTokenUsageWrite => ({ sessionId: session.id, nativeSessionId: "conversation", projectId: "project-cli-tokens", admission, baseline: false, observations: [{ key: "cumulative", usage: { inputTokens: count, outputTokens: 0, cachedTokens: 1000, cacheWriteTokens: 0 } }], cursor: { bytes: 100, fileIdentity: "1:2", phase: "observing" }, limits: { hard: 20 } });
    return { task, sessions, request };
  }
  it.each(["claude-code", "codex"])("actual observer credits trusted %s mismatch batch before persisting failure", async adapter => {
    const { CliTokenUsageObserver } = await import("../../../../engine/src/cli-agent/token-usage-observer.js");
    const f = await fixture(adapter), root = await realpath(h.rootDir()), path = join(root, "identity-fixture.jsonl");
    await writeFile(path, "");
    let listener: any;
    const writes: CliTokenUsageWrite[] = [];
    const observer = new CliTokenUsageObserver({ ...f.sessions.getSession(f.request(0).sessionId)!, worktreePath: root }, {
      store: { recordCliTokenUsageFenced: async (id, write) => { writes.push(structuredClone(write)); return h.store().recordCliTokenUsageFenced(id, write); } },
      sessions: f.sessions, admission, limits: { hard: 100 }, pollMs: 100000,
    }, { registerNativeIdentityListener: (_id: string, fn: any) => { listener = fn; return () => {}; } } as any, () => {});
    try {
      if (adapter === "codex") { await observer.admitFresh({ nativeSessionId: "conversation", transcriptPath: path, selectedModel: "gpt-a", selectedProvider: "openai" }); await observer.beforeFirstTurn(); }
      else { listener({ nativeSessionId: "conversation", transcriptPath: path }); await observer.ready(); }
      const rows = adapter === "codex" ? [ { type: "session_meta", payload: { id: "conversation", cwd: root, model_provider: "openai" } }, { type: "turn_context", payload: { model: "gpt-b" } }, { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 7, output_tokens: 0, cached_input_tokens: 0 } } } } ]
        : ["claude-a", "claude-b"].map((model, i) => ({ type: "assistant", cwd: root, sessionId: "conversation", message: { model, id: `m${i}`, usage: { input_tokens: i + 3, output_tokens: 0 } } }));
      await appendFile(path, rows.map(row => JSON.stringify(row)+"\n").join(""));
      await expect(observer.drain()).rejects.toThrow(/identity|model/);
      const task = await h.store().getTask(f.task.id);
      expect(task.tokenUsage?.inputTokens).toBe(7);
      expect((task.sourceMetadata as any).cliTokenUsage.cursors[`${adapter}:conversation`].phase).toBe("failed");
      expect((await h.store().recordCliTokenUsageFenced(f.task.id, writes.at(-1)!)).observedWorkTokens).toBe(7);
    } finally { observer.close(); }
  });
  it("preserves current-stream identity and incomplete coverage with credit replay", async () => {
    const f = await fixture();
    const identity = { selected: { model: "gpt-a", provider: "openai", source: "codex-thread-start" }, observed: { model: "gpt-a", provider: "openai", source: "codex-turn-context" }, coverage: "complete" };
    const write = { ...f.request(3), identity } as any;
    const first = await h.store().recordCliTokenUsageFenced(f.task.id, write);
    expect((first.task.sourceMetadata as any).cliTokenUsage.identities["codex:conversation"]).toEqual(identity);
    const baseline = { ...f.request(3), baseline: true };
    const resumed = await h.store().recordCliTokenUsageFenced(f.task.id, baseline);
    expect((resumed.task.sourceMetadata as any).cliTokenUsage.identities["codex:conversation"]).toEqual({ ...identity, coverage: "incomplete" });
    expect(resumed.observedWorkTokens).toBe(3);
    const partial = { ...write, identity: { ...identity, coverage: "incomplete" } };
    await h.store().recordCliTokenUsageFenced(f.task.id, partial);
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, write)).rejects.toThrow(/identity/i);
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, { ...partial, observations: f.request(11).observations, identity: { ...partial.identity, observed: { ...identity.observed, model: "gpt-b" } } })).rejects.toThrow(/identity/i);
    expect((await h.store().getTask(f.task.id)).tokenUsage?.inputTokens).toBe(3);
    const failed = { ...partial, observations: f.request(8).observations, cursor: { ...partial.cursor, phase: "failed" } };
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, failed)).observedWorkTokens).toBe(8);
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, failed)).observedWorkTokens).toBe(8);
  });
  it("failed cursor charges once and cannot revive", async () => {
    const f = await fixture();
    const failed = { ...f.request(7), cursor: { ...f.request(7).cursor, phase: "failed" as const } };
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, failed)).observedWorkTokens).toBe(7);
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, failed)).observedWorkTokens).toBe(7);
    for (const phase of ["observing", "drained", "baseline", "awaiting-file"] as const) {
      await expect(h.store().recordCliTokenUsageFenced(f.task.id, { ...failed, cursor: { ...failed.cursor, phase } })).rejects.toThrow();
    }
    expect((await h.store().getTask(f.task.id)).tokenUsage?.inputTokens).toBe(7);
  });
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

  async function hermesFixture() {
    const f = await fixture("hermes");
    const request = (inputTokens: number, phase = "observing", baseline = false): any => ({
      kind: "hermes-session-cumulative", sessionId: f.request(0).sessionId,
      nativeSessionId: "conversation", projectId: "project-cli-tokens", admission,
      baseline, usage: { inputTokens, outputTokens: 2, cachedTokens: 1000, cacheWriteTokens: 1 },
      cursor: { kind: "hermes-session-cumulative", nativeSessionId: "conversation", phase }, limits: { hard: 100 },
    });
    return { ...f, request };
  }
  it("Hermes cumulative replay survives a fresh store and initial resumed baseline excludes historical totals once", async () => {
    const f = await hermesFixture();
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, f.request(10, "baseline", true))).observedWorkTokens).toBe(0);
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, f.request(15))).observedWorkTokens).toBe(5);
    const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
    expect((await other.recordCliTokenUsageFenced(f.task.id, f.request(15))).observedWorkTokens).toBe(5);
    expect((await other.recordCliTokenUsageFenced(f.task.id, f.request(18, "baseline", true))).observedWorkTokens).toBe(8);
    const state: any = (await h.store().getTask(f.task.id)).sourceMetadata?.cliTokenUsage;
    expect(state.sessions["hermes:conversation"]).toEqual({ "session-cumulative": f.request(18).usage });
    expect(state.cursors["hermes:conversation"]).toEqual(f.request(18, "baseline", true).cursor);
  });
  it("Hermes failure credits partial actual increases once and never resumes or drains", async () => {
    const f = await hermesFixture();
    await h.store().recordCliTokenUsageFenced(f.task.id, f.request(4));
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, f.request(7, "failed"))).observedWorkTokens).toBe(10);
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, f.request(7, "failed"))).observedWorkTokens).toBe(10);
    for (const phase of ["observing", "drained", "baseline"]) await expect(h.store().recordCliTokenUsageFenced(f.task.id, f.request(9, phase))).rejects.toThrow(/failed/i);
    expect((await h.store().getTask(f.task.id)).tokenUsage?.inputTokens).toBe(7);
  });
  it("Hermes refuses counter rollback, invented transcript or keys, and missing finite positive hard cap without writes", async () => {
    const f = await hermesFixture();
    await h.store().recordCliTokenUsageFenced(f.task.id, f.request(4));
    for (const request of [f.request(3), { ...f.request(5), usage: { ...f.request(5).usage, cachedTokens: 999 } },
      ...[undefined, 0, -1, Infinity].map(hard => ({ ...f.request(5), limits: { hard } })),
      { ...f.request(5), observations: [{ key: "other", usage: f.request(5).usage }] },
      { ...f.request(5), cursor: { ...f.request(5).cursor, bytes: 0, fileIdentity: "fake" } },
    ]) await expect(h.store().recordCliTokenUsageFenced(f.task.id, request)).rejects.toThrow();
    expect((await h.store().getTask(f.task.id)).tokenUsage?.inputTokens).toBe(4);
  });
  it("Hermes requires actual row identity and current native owner before replay and after Reset", async () => {
    const f = await hermesFixture();
    await h.store().recordCliTokenUsageFenced(f.task.id, f.request(1));
    for (const request of [{ ...f.request(1), nativeSessionId: "invented" }, { ...f.request(1), projectId: "wrong" },
      { ...f.request(1), cursor: { ...f.request(1).cursor, nativeSessionId: "other" } },
      { ...f.request(1), admission: { ...admission, leaseEpoch: 2 } },
    ]) await expect(h.store().recordCliTokenUsageFenced(f.task.id, request)).rejects.toThrow();
    await h.store().resetTaskPublication(f.task.id, "todo");
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, f.request(1))).rejects.toThrow(/ownership/);
  });
  it("Hermes independent stores atomically sum concurrent native sessions and pause at the hard limit", async () => {
    const f = await hermesFixture();
    const second = f.sessions.createSession({ projectId: "project-cli-tokens", taskId: f.task.id, adapterId: "hermes", nativeSessionId: "second", purpose: "execute" }); await f.sessions.flush();
    const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
    const a = { ...f.request(7), limits: { hard: 20 } };
    const b = { ...a, sessionId: second.id, nativeSessionId: "second", cursor: { ...a.cursor, nativeSessionId: "second" } };
    const results = await Promise.all([h.store().recordCliTokenUsageFenced(f.task.id, a), other.recordCliTokenUsageFenced(f.task.id, b)]);
    expect(results.map(r => r.observedWorkTokens).sort((a,b) => a-b)).toEqual([10,20]);
    expect(results.filter(r => r.hardExceeded)).toHaveLength(1);
    expect((await h.store().getTask(f.task.id)).paused).toBe(true);
  });

  it("Hermes credits first failed observation rather than accepting a failure as historical baseline", async () => {
    const f = await hermesFixture();
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, f.request(5, "failed", true))).rejects.toThrow(/baseline/i);
    expect((await h.store().recordCliTokenUsageFenced(f.task.id, f.request(5, "failed"))).observedWorkTokens).toBe(8);
  });
  it("Hermes overflow rolls back ledger and aggregate; postcommit projection retry is idempotent", async () => {
    const f = await hermesFixture();
    await h.store().recordCliTokenUsageFenced(f.task.id, f.request(1));
    const before = await h.store().getTask(f.task.id);
    await expect(h.store().recordCliTokenUsageFenced(f.task.id, { ...f.request(Number.MAX_SAFE_INTEGER), limits: { hard: Number.MAX_SAFE_INTEGER } })).rejects.toThrow(/overflow/);
    const unchanged = await h.store().getTask(f.task.id);
    expect(unchanged.sourceMetadata).toEqual(before.sourceMetadata);
    expect(unchanged.tokenUsage).toEqual(before.tokenUsage);
    const projection = vi.spyOn(h.store(), "writeTaskJsonFile").mockRejectedValueOnce(new Error("projection refused"));
    try { await expect(h.store().recordCliTokenUsageFenced(f.task.id, f.request(6))).rejects.toThrow("projection refused"); }
    finally { projection.mockRestore(); }
    const other = new TaskStore(h.rootDir(), undefined, { asyncLayer: h.layer() });
    expect((await other.recordCliTokenUsageFenced(f.task.id, f.request(6))).observedWorkTokens).toBe(9);
  });
  it("Hermes does not accept another adapter's row or an invented session row", async () => {
    const f = await hermesFixture();
    const other = f.sessions.createSession({ projectId: "project-cli-tokens", taskId: f.task.id, adapterId: "codex", nativeSessionId: "conversation", purpose: "execute" }); await f.sessions.flush();
    for (const sessionId of ["not-registered", other.id]) await expect(h.store().recordCliTokenUsageFenced(f.task.id, { ...f.request(1), sessionId })).rejects.toThrow(/identity/);
  });

});
