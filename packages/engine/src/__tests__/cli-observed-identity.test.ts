import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, realpath, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliTokenUsageObserver } from "../cli-agent/token-usage-observer.js";
import { advanceCliTokenLedger } from "@fusion/core";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
const usage = (model: string | undefined, id = "m", tokens = 3) => JSON.stringify({ type: "assistant", sessionId: "native", message: { id, model, usage: { input_tokens: tokens, output_tokens: 0 } } }) + "\n";
async function fixture(adapterId = "claude-code", baseline = "", priorIdentity?: any) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fusion-identity-"))), path = join(root, "native.jsonl");
  await writeFile(path, baseline);
  let listener: any, ledger: any, total = 0;
  const writes: any[] = [], stop = vi.fn();
  const observer = new CliTokenUsageObserver({ id: "record", taskId: "task", projectId: "project", adapterId, worktreePath: root } as any,
    { sessions: { flush: async () => {} }, admission: { runId: "run", leaseEpoch: 1, agentId: "agent", nodeId: "node" }, limits: { hard: 1000 }, pollMs: 100000,
      store: { recordCliTokenUsageFenced: async (_id, write) => { writes.push(structuredClone(write)); for (const event of write.observations) { const next = advanceCliTokenLedger(ledger, `${adapterId}:native`, event.key, event.usage, write.baseline); ledger = next.ledger; total += next.delta.inputTokens; } return { hardExceeded: false, observedWorkTokens: total, task: { sourceMetadata: { cliTokenUsage: { identities: priorIdentity ? { [`${adapterId}:native`]: { ...priorIdentity, coverage: "incomplete" } } : {} } } } as any }; } } },
    { registerNativeIdentityListener: (_id: string, fn: any) => { listener = fn; return () => {}; } } as any, stop);
  cleanup.push(async () => { observer.close(); await rm(root, { recursive: true, force: true }); });
  return { root, path, observer, stop, writes, total: () => total, start: async () => { listener({ nativeSessionId: "native", transcriptPath: path }); await observer.ready(); } };
}
it.each([[undefined, "claude-a"], ["claude-a", undefined]])("partial observed model coverage never borrows prior evidence: %s then %s", async (first, second) => {
  const f = await fixture(); await f.start();
  await appendFile(f.path, usage(first, "one") + usage(second, "two")); await f.observer.drain();
  expect(f.total()).toBe(6);
  expect(f.writes.at(-1).identity).toMatchObject({ coverage: "incomplete", observed: { model: "claude-a", source: "claude-assistant-message" } });
});
it("baseline-only model does not become current-turn identity", async () => {
  const f = await fixture("claude-code", usage("claude-old", "old")); await f.start();
  await appendFile(f.path, usage(undefined, "new")); await f.observer.drain();
  expect(f.total()).toBe(3);
  expect(f.writes.at(-1).identity).toEqual({ coverage: "incomplete" });
});
it("charges the trusted Claude batch including mismatching model exactly once then fails", async () => {
  const f = await fixture(); await f.start();
  await appendFile(f.path, usage("claude-a", "one") + usage("claude-b", "two") + usage("claude-b", "two"));
  await expect(f.observer.drain()).rejects.toThrow(/model|identity/i);
  expect(f.total()).toBe(6); expect(f.stop).toHaveBeenCalledOnce();
  expect(f.writes.at(-1)).toMatchObject({ cursor: { phase: "failed" }, identity: { observed: { model: "claude-a" } } });
});
it("charges Codex usage after the mismatching context marker in the same trusted batch", async () => {
  const f = await fixture("codex");
  await f.observer.admitFresh({ nativeSessionId: "native", transcriptPath: f.path, selectedModel: "gpt-a", selectedProvider: "openai" } as any);
  await f.observer.beforeFirstTurn();
  await appendFile(f.path, [ { type: "session_meta", payload: { id: "native", cwd: f.root, model_provider: "openai" } },
    { type: "turn_context", payload: { model: "gpt-b" } },
    { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 7, cached_input_tokens: 0, output_tokens: 0 } } } } ].map(x => JSON.stringify(x)+"\n").join(""));
  await expect(f.observer.drain()).rejects.toThrow(/model|identity/i);
  expect(f.total()).toBe(7); expect(f.stop).toHaveBeenCalledOnce();
  expect(f.writes.at(-1)).toMatchObject({ cursor: { phase: "failed" }, identity: { selected: { model: "gpt-a", provider: "openai" } } });
});
it("complete observed Claude response identity survives final drain without a guessed provider", async () => {
  const f = await fixture(); await f.start(); await appendFile(f.path, usage("claude-a")); await f.observer.drain();
  expect(f.writes.at(-1).identity).toEqual({ coverage: "complete", observed: { model: "claude-a", source: "claude-assistant-message" } });
});
it("wrong provided native cwd refuses the entire untrusted batch", async () => {
  const f = await fixture(); await f.start();
  const wrong = JSON.parse(usage("claude-a")); wrong.cwd = "/";
  await appendFile(f.path, JSON.stringify(wrong) + "\n");
  await expect(f.observer.drain()).rejects.toThrow(/worktree|cwd/i);
  expect(f.total()).toBe(0); expect(f.writes).toHaveLength(1);
});
it("wrong native session refuses usage even when its model looks correct", async () => {
  const f = await fixture(); await f.start(); const wrong = JSON.parse(usage("claude-a")); wrong.sessionId = "other";
  await appendFile(f.path, JSON.stringify(wrong) + "\n");
  await expect(f.observer.drain()).rejects.toThrow(/session/i); expect(f.total()).toBe(0);
});
it("Codex returned selection is corroborated by current native turn context and header provider", async () => {
  const f = await fixture("codex");
  await f.observer.admitFresh({ nativeSessionId: "native", transcriptPath: f.path, selectedModel: "gpt-a", selectedProvider: "openai" });
  await f.observer.beforeFirstTurn();
  await appendFile(f.path, [ { type: "session_meta", payload: { id: "native", cwd: f.root, model_provider: "openai" } },
    { type: "turn_context", payload: { model: "gpt-a", model_provider: null } },
    { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 7, cached_input_tokens: 0, output_tokens: 0 } } } } ].map(x => JSON.stringify(x)+"\n").join(""));
  await f.observer.drain();
  expect(f.writes.at(-1).identity).toEqual({ coverage: "complete", selected: { model: "gpt-a", provider: "openai", source: "codex-thread-start" }, observed: { model: "gpt-a", provider: "openai", source: "codex-turn-context" } });
});
it("missing Codex provider later preserves prior evidence but makes coverage incomplete without losing usage", async () => {
  const f = await fixture("codex");
  await f.observer.admitFresh({ nativeSessionId: "native", transcriptPath: f.path, selectedModel: "gpt-a", selectedProvider: "openai" }); await f.observer.beforeFirstTurn();
  const rows = (provider: string | undefined, tokens: number) => [ { type: "session_meta", payload: { id: "native", cwd: f.root, model_provider: provider } }, { type: "turn_context", payload: { model: "gpt-a" } }, { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: tokens, cached_input_tokens: 0, output_tokens: 0 } } } } ].map(x => JSON.stringify(x)+"\n").join("");
  await appendFile(f.path, rows("openai", 3) + rows(undefined, 7)); await f.observer.drain();
  expect(f.total()).toBe(7);
  expect(f.writes.at(-1).identity).toMatchObject({ coverage: "incomplete", observed: { provider: "openai" } });
});

it.each(["claude-b", undefined])("repeated baseline hydrates old evidence without borrowing approval: %s", async model => {
  const prior = { coverage: "complete", observed: { model: "claude-a", source: "claude-assistant-message" } };
  const f = await fixture("claude-code", usage("claude-a", "old"), prior); await f.start();
  await appendFile(f.path, usage(model, "new", 7));
  if (model) await expect(f.observer.drain()).rejects.toThrow(/identity|model/); else await f.observer.drain();
  expect(f.total()).toBe(7);
  expect(f.writes.at(-1)).toMatchObject({ identity: { coverage: "incomplete", observed: prior.observed }, cursor: { phase: model ? "failed" : "drained" } });
});
