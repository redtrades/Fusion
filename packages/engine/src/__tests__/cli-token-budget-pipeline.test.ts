import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, readFile, appendFile, rm, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CliSession, CliSessionStore } from "@fusion/core";
import { advanceCliTokenLedger, type CliTokenLedger, type CliTokenUsageWrite } from "@fusion/core";
import { CliSessionManager } from "../cli-agent/session-manager.js";
import { CliAdapterRegistry } from "../cli-agent/adapter.js";
import { codexAdapter } from "../cli-agent/adapters/codex.js";
import { claudeCodeAdapter } from "../cli-agent/adapters/claude-code.js";
import { TelemetryHub } from "../cli-agent/telemetry-hub.js";
import { launchCliTaskSession } from "../cli-agent/task-session.js";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const release of cleanup.splice(0).reverse()) await release(); });
async function fixture(hard = 10, sendIdentity = true, codexAlias = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fusion-budget-pipeline-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const worktree = codexAlias ? `${root}-alias` : root;
  if (codexAlias) { await symlink(root, worktree); cleanup.push(() => rm(worktree)); }
  const transcript = join(worktree, "native.jsonl");
  await writeFile(transcript, codexAlias ? JSON.stringify({ type: "session_meta", payload: { id: "conversation", cwd: root } }) + "\n" : "");
  const rows = new Map<string, CliSession>();
  const store = Object.assign(new EventEmitter(), {
    listSessions: () => [...rows.values()],
    getSession: (id: string) => rows.get(id),
    createSession: (input: any) => { const row = { ...input, id: "native-record", nativeSessionId: null, terminationReason: null, resumeAttempts: 0 } as CliSession; rows.set(row.id, row); return row; },
    updateSession: (id: string, patch: any) => { const row = { ...rows.get(id)!, ...patch }; rows.set(id, row); return row; },
    flush: async () => {},
  }) as unknown as CliSessionStore;
  const hub = new TelemetryHub({ store });
  const registry = new CliAdapterRegistry(); registry.register(codexAlias ? codexAdapter : claudeCodeAdapter);
  const child = { pid: 999999, write: vi.fn(), kill: vi.fn(), pause() {}, resume() {}, resize() {}, onData(fn: (s: string) => void) { queueMicrotask(() => fn("\x1b[?2004h")); return { dispose() {} }; }, onExit() { return { dispose() {} }; } };
  let hookReadyAtSpawn = false;
  const manager = new CliSessionManager({ store, registry, loadPty: async () => ({ spawn(_command: string, _args: string[], opts: any) {
    // The actual manager must finish preparation before starting the child.
    const contextPath = opts.env.FUSION_CLI_HOOK_CONTEXT;
    if (!contextPath) throw new Error("Missing native hook context before PTY");
    void readFile(contextPath, "utf8").then(raw => {
      const context = JSON.parse(raw); hookReadyAtSpawn = hub.validateToken(context.sessionId, context.token);
      if (sendIdentity) hub.ingestNativeSessionStart(context.sessionId, { nativeSessionId: "conversation", transcriptPath: transcript });
    });
    return child as any;
  } }) });
  cleanup.push(() => manager.dispose());
  let ledger: CliTokenLedger | undefined, total = 0, phase = "", paused = false;
  const persistence = { recordCliTokenUsageFenced: async (_id: string, input: CliTokenUsageWrite) => {
    for (const event of input.observations) { const next = advanceCliTokenLedger(ledger, "claude-code:conversation", event.key, event.usage, input.baseline); ledger = next.ledger; total += next.delta.inputTokens + next.delta.outputTokens + next.delta.cacheWriteTokens; }
    phase = input.cursor.phase; paused ||= total >= hard;
    return { hardExceeded: paused, observedWorkTokens: total, task: {} as any };
  } };
  const session = await launchCliTaskSession({ taskId: "task", projectId: "project", worktreePath: worktree, prompt: "do work", config: { cliAdapterId: codexAlias ? "codex" : "claude-code" }, manager, hub, registry, hookDirRoot: root, hookEndpointUrl: "http://127.0.0.1:45000/api/cli-agent/hooks", usageProtection: { store: persistence, sessions: store, admission: { runId: "run", leaseEpoch: 1, agentId: "agent", nodeId: "host" }, limits: { hard }, pollMs: 5, identityTimeoutMs: 40 } });
  cleanup.push(() => session.kill());
  const emitUsage = async (input: number, id = "message") => appendFile(transcript, JSON.stringify(codexAlias ? { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 0 } } } } : { type: "assistant", sessionId: "conversation", message: { id, usage: { input_tokens: input, output_tokens: 0 } } }) + "\n");
  return { child, hub, session, emitUsage, transcript, state: () => ({ total, paused, phase, hookReadyAtSpawn }) };
}
describe("native CLI observed budget pipeline", () => {
  it("prepares hooks before spawn, accounts replay once and kills after observed crossing", async () => {
    const f = await fixture();
    await vi.waitFor(() => expect(f.child.write).toHaveBeenCalled());
    expect(f.state().hookReadyAtSpawn).toBe(true);
    await f.emitUsage(7); await f.emitUsage(7);
    await vi.waitFor(() => expect(f.state().total).toBe(7));
    await f.emitUsage(11);
    expect(await f.session.result()).toMatchObject({ kind: "killed" });
    expect(f.state()).toMatchObject({ total: 11, paused: true });
    expect(f.child.kill).toHaveBeenCalled();
  });
  it("accepts a trusted transcript alias and canonical Codex cwd for the same worktree", async () => {
    const f = await fixture(100, true, true);
    await vi.waitFor(() => expect(f.child.write).toHaveBeenCalled());
    await f.emitUsage(5);
    f.hub.ingest(f.session.sessionId, { kind: "done" });
    expect(await f.session.result()).toMatchObject({ kind: "success" });
    expect(f.state()).toMatchObject({ total: 5, phase: "drained" });
  });
  it("never injects when the trusted native hook is absent", async () => {
    const f = await fixture(10, false);
    expect(await f.session.result()).toMatchObject({ kind: "killed" });
    expect(f.child.write).not.toHaveBeenCalled();
  });
  it("drains final appended usage before success acknowledgment", async () => {
    const f = await fixture(100);
    await vi.waitFor(() => expect(f.child.write).toHaveBeenCalled());
    await f.emitUsage(5);
    f.hub.ingest(f.session.sessionId, { kind: "done" });
    expect(await f.session.result()).toMatchObject({ kind: "success" });
    expect(f.state()).toMatchObject({ total: 5, phase: "drained" });
  });
  it("does not report protection when no native usage schema appears", async () => {
    const f = await fixture(100);
    await vi.waitFor(() => expect(f.child.write).toHaveBeenCalled());
    f.hub.ingest(f.session.sessionId, { kind: "done" });
    expect(await f.session.result()).toMatchObject({ kind: "killed" });
  });
  it("malformed usage cannot be acknowledged as protected success", async () => {
    const f = await fixture(100);
    await vi.waitFor(() => expect(f.child.write).toHaveBeenCalled());
    await appendFile(f.transcript, '{"type":"assistant","sessionId":"conversation","message":{"usage":{}}}\n');
    f.hub.ingest(f.session.sessionId, { kind: "done" });
    expect(await f.session.result()).toMatchObject({ kind: "killed" });
  });
});
