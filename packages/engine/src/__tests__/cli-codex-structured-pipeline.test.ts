import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advanceCliTokenLedger, type CliSession, type CliSessionStore, type CliTokenLedger, type CliTokenUsageWrite } from "@fusion/core";
import { CliSessionManager } from "../cli-agent/session-manager.js";
import { CliAdapterRegistry } from "../cli-agent/adapter.js";
import { codexAdapter } from "../cli-agent/adapters/codex.js";
import { TelemetryHub } from "../cli-agent/telemetry-hub.js";
import { launchCliTaskSession } from "../cli-agent/task-session.js";
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    if (!String(args[0]).endsWith("/synthetic-native.cjs")) throw new Error("Test requires the explicit synthetic native peer");
    return actual.spawn(...args);
  } };
});
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const release of cleanup.splice(0).reverse()) await release(); });
async function fixture(hard = 100, admissionGate = Promise.resolve(), drainGate = Promise.resolve()) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fusion-structured-fixture-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const nativeId = "01a09e41-4fbc-73f3-96db-73cd2e58a8e2", transcript = join(root, ".codex", "sessions", "future.jsonl"), receipt = join(root, "turn-receipt.json");
  const command = join(root, "synthetic-native.cjs");
  await writeFile(command, `#!${process.execPath}
if(process.argv.includes("--version")){console.log("codex-cli 0.154.0");process.exit(0);}
const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
rl.on('line',line=>{const q=JSON.parse(line);if(!q.id)return;
if(q.method==='initialize')return send({id:q.id,result:{}});
if(q.method==='thread/start')return send({id:q.id,result:{model:'chosen',modelProvider:'openai',cwd:${JSON.stringify(root)},thread:{id:${JSON.stringify(nativeId)},sessionId:${JSON.stringify(nativeId)},path:${JSON.stringify(transcript)},cwd:${JSON.stringify(root)},ephemeral:false}}});
if(q.method==='turn/start'){
fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({method:q.method,threadId:q.params.threadId}));
send({id:q.id,result:{turn:{id:'turn-1'}}});send({method:'turn/completed',params:{threadId:${JSON.stringify(nativeId)},turn:{id:'turn-1',status:'completed'}}});
setTimeout(()=>{fs.mkdirSync(${JSON.stringify(join(root, ".codex", "sessions"))},{recursive:true});fs.writeFileSync(${JSON.stringify(transcript)},JSON.stringify({type:'session_meta',payload:{id:${JSON.stringify(nativeId)},cwd:${JSON.stringify(root)}}})+'\\n'+JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:9,cached_input_tokens:2,output_tokens:3}}}})+'\\n');},30);
}});`);
  await chmod(command, 0o700);
  const rows = new Map<string, CliSession>();
  const store = Object.assign(new EventEmitter(), {
    listSessions: () => [...rows.values()], getSession: (id: string) => rows.get(id),
    createSession: (input: any) => { const row = { ...input, id: "native-record", nativeSessionId: null, terminationReason: null, resumeAttempts: 0 } as CliSession; rows.set(row.id, row); return row; },
    updateSession: (id: string, patch: any) => { const row = { ...rows.get(id)!, ...patch }; rows.set(id, row); return row; }, flush: async () => {},
  }) as unknown as CliSessionStore;
  const hub = new TelemetryHub({ store }); const registry = new CliAdapterRegistry(); registry.register(codexAdapter);
  const manager = new CliSessionManager({ store, registry, loadPty: async () => { throw new Error("Structured native session must not load PTY"); } });
  cleanup.push(() => manager.dispose());
  let total = 0, ledger: CliTokenLedger | undefined; const writes: CliTokenUsageWrite[] = [];
  const previousHome = process.env.HOME, previousCodexHome = process.env.CODEX_HOME; process.env.HOME = root; process.env.CODEX_HOME = join(root, ".codex");
  let session;
  try { session = await launchCliTaskSession({ taskId: "task", projectId: "project", worktreePath: root, prompt: "synthetic fixture only", config: { cliAdapterId: "codex", settings: { command, model: "chosen" } }, manager, hub, registry, hookDirRoot: root, hookEndpointUrl: "http://127.0.0.1:45000/unused", usageProtection: {
    sessions: store, admission: { runId: "run", leaseEpoch: 1, agentId: "agent", nodeId: "host" }, limits: { hard }, pollMs: 5,
    store: { recordCliTokenUsageFenced: async (_task, input) => {
      if (input.fresh) await admissionGate;
      writes.push(input);
      for (const event of input.observations) { const next = advanceCliTokenLedger(ledger, `codex:${nativeId}`, event.key, event.usage, input.baseline); ledger = next.ledger; total += next.delta.inputTokens + next.delta.outputTokens + next.delta.cacheWriteTokens; }
      if (input.cursor.phase === "drained") await drainGate;
      return { hardExceeded: total >= hard, observedWorkTokens: total, task: {} as any };
    } },
  } });
  } finally { process.env.HOME = previousHome; if (previousCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodexHome; }
  const exited = manager.waitForExit(session.sessionId);
  cleanup.push(async () => { await session.kill(); await exited; });
  return { session, manager, writes, receipt, store, total: () => total, exited };
}
it("owns native identity and first-request accounting through manager/store/task completion without PTY", async () => {
  const f = await fixture();
  const attachment = f.manager.attach(f.session.sessionId);
  expect(() => attachment.write("not JSON input")).toThrow("read-only"); attachment.detach();
  expect(await f.session.result()).toMatchObject({ kind: "success" });
  expect(f.writes[0]).toMatchObject({ fresh: true, observations: [], cursor: { phase: "awaiting-file" } });
  expect(f.writes.at(-1)?.cursor.phase).toBe("drained"); expect(f.total()).toBe(10);
  expect(JSON.parse(await readFile(f.receipt, "utf8"))).toMatchObject({ method: "turn/start", threadId: f.store.getSession(f.session.sessionId)?.nativeSessionId });
  await f.session.reap(); await f.exited; expect(f.manager.activeCount()).toBe(0);
});
it("cancellation while durable admission is pending prevents any turn/start", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(100, gate);
  await vi.waitFor(() => expect(f.store.getSession(f.session.sessionId)?.nativeSessionId).toBeTruthy());
  await f.session.kill(); release(); await f.exited;
  await expect(readFile(f.receipt)).rejects.toThrow();
  expect(await f.session.result()).toMatchObject({ kind: "killed" });
});
it("observed crossing kills and cannot acknowledge the completed native turn", async () => {
  const f = await fixture(9);
  expect(await f.session.result()).toMatchObject({ kind: "killed" });
  expect(f.total()).toBe(10); await f.exited;
});

it("refuses protected native resume instead of creating a fresh root thread", async () => {
  const f = await fixture();
  await expect(f.manager.spawn({ adapterId: "codex", projectId: "project", taskId: "task", purpose: "execute", worktreePath: "/unused", resume: { sessionId: f.session.sessionId, nativeSessionId: "old" }, codexStructured: { admit: async () => {} } })).rejects.toThrow("Unsupported Codex structured launch");
  await expect(f.manager.spawn({ adapterId: "codex", projectId: "project", purpose: "execute", resume: { sessionId: f.session.sessionId, nativeSessionId: "old" }, beforePtyStart: async () => {} })).rejects.toThrow("Protected Codex structured resume unsupported");
  expect(f.store.listSessions()).toHaveLength(1);
  await f.session.kill(); await f.exited;
});

it("retains the native task until the final durable accounting acknowledgment", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(100, Promise.resolve(), gate);
  try {
    await vi.waitFor(() => expect(f.writes.at(-1)?.cursor.phase).toBe("drained"));
    expect(f.session.isSettled).toBe(false); expect(f.manager.isLive(f.session.sessionId)).toBe(true);
    release(); expect(await f.session.result()).toMatchObject({ kind: "success" });
  } finally { release(); }
});
