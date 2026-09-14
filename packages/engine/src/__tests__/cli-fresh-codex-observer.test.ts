import { afterEach, expect, it } from "vitest";
import { mkdtemp, realpath, rm, writeFile, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliSession, CliTokenUsageWrite } from "@fusion/core";
import { CliTokenUsageObserver } from "../cli-agent/token-usage-observer.js";
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const release of cleanup.splice(0).reverse()) await release(); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fresh-codex-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "future.jsonl"), writes: CliTokenUsageWrite[] = [];
  const observer = new CliTokenUsageObserver({ id: "cli", nativeSessionId: "native", taskId: "task", projectId: "project", adapterId: "codex", worktreePath: root } as CliSession, {
    admission: { runId: "run", leaseEpoch: 1, agentId: "agent", nodeId: "node" }, limits: { hard: 100 }, sessions: { flush: async () => {} }, pollMs: 10000,
    store: { recordCliTokenUsageFenced: async (_task, input) => { writes.push(input); return { hardExceeded: false, observedWorkTokens: 0, task: {} as any }; } },
  }, { registerNativeIdentityListener: () => () => {} } as any, () => {});
  cleanup.push(() => observer.close());
  const header = JSON.stringify({ type: "session_meta", payload: { id: "native", cwd: root } }) + "\n";
  const usage = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 9, cached_input_tokens: 2, output_tokens: 3 } } } }) + "\n";
  return { observer, path, writes, header, usage, root };
}
it("durably admits absent native path without inode and charges the first request from zero", async () => {
  const f = await fixture(); await f.observer.admitFresh({ nativeSessionId: "native", transcriptPath: f.path });
  expect(f.writes[0]).toMatchObject({ fresh: true, baseline: false, observations: [], cursor: { phase: "awaiting-file", bytes: 0, transcriptPath: f.path } });
  expect(f.writes[0].cursor.fileIdentity).toBeUndefined();
  await f.observer.beforeFirstTurn();
  await writeFile(f.path, f.header + f.usage); await f.observer.drain();
  expect(f.writes.flatMap(write => write.observations)).toMatchObject([{ usage: { inputTokens: 7, outputTokens: 3 } }]);
  expect(f.writes.every(write => !write.baseline)).toBe(true);
  expect(f.writes.at(-1)?.cursor.phase).toBe("drained");
});
it("refuses prior usage before fresh admission", async () => {
  const f = await fixture(); await writeFile(f.path, f.header + f.usage);
  await expect(f.observer.admitFresh({ nativeSessionId: "native", transcriptPath: f.path })).rejects.toThrow(/prior|fresh/i);
  expect(f.writes).toHaveLength(0);
});
it("missing file cannot be acknowledged as successful drain", async () => {
  const f = await fixture(); await f.observer.admitFresh({ nativeSessionId: "native", transcriptPath: f.path });
  await expect(f.observer.drain()).rejects.toThrow();
});

it("refuses a populated path appearing after admission but before first request", async () => {
  const f = await fixture(); await f.observer.admitFresh({ nativeSessionId: "native", transcriptPath: f.path });
  await writeFile(f.path, f.header + f.usage);
  await expect(f.observer.beforeFirstTurn()).rejects.toThrow("prior usage");
  expect(f.writes).toHaveLength(1);
});
it("binds matching canonical cwd aliases, then refuses inode replacement", async () => {
  const f = await fixture(); const alias = `${f.root}-alias`; await symlink(f.root, alias); cleanup.push(() => rm(alias));
  await f.observer.admitFresh({ nativeSessionId: "native", transcriptPath: f.path });
  await f.observer.beforeFirstTurn();
  await writeFile(f.path, JSON.stringify({ type: "session_meta", payload: { id: "native", cwd: alias } }) + "\n" + f.usage);
  await f.observer.drain();
  await rename(f.path, `${f.path}.old`); await writeFile(f.path, f.header + f.usage);
  await expect(f.observer.drain()).rejects.toThrow("replaced");
});
it.each(["wrong-header", "malformed"])("fails closed on fresh stream %s", async mode => {
  const f = await fixture(); await f.observer.admitFresh({ nativeSessionId: "native", transcriptPath: f.path });
  await writeFile(f.path, mode === "wrong-header" ? f.header.replace('"native"', '"different"') + f.usage : f.header + '{broken}\n');
  await expect(f.observer.drain()).rejects.toThrow();
  expect(f.writes.some(write => write.cursor.phase === "drained")).toBe(false);
});
