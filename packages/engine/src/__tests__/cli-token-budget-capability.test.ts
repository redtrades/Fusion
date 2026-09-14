import { describe, expect, it } from "vitest";
import { inspectCliTokenBudget } from "../cli-agent/token-budget-capability.js";
const admission = { runId: "run", leaseEpoch: 1, agentId: "agent", nodeId: "host" };
const query = { taskId: "task", adapterId: "codex" as const, admission };
function fixture() {
  const task = { id: "task", checkoutRunId: "run", checkoutLeaseEpoch: 1, checkedOutBy: "agent", checkoutNodeId: "host", tokenBudgetOverride: { hard: 10 }, sourceMetadata: {} as any };
  const store = { getTask: async () => task, getSettingsByScope: async () => ({ project: {}, global: {} }), getProjectId: () => "project" } as any;
  const sessions = { flush: async () => {}, getSession: () => ({ id: "record", nativeSessionId: "conversation", projectId: "project", taskId: "task", adapterId: "codex" }) } as any;
  return { task, store, sessions };
}
describe("native accounting capability inspection", () => {
  it("reports native gate/config, not a fabricated hook-readiness flag", async () => {
    const f = fixture();
    expect(await inspectCliTokenBudget(f.store, f.sessions, query)).toEqual({ protocol: "native-cli-observed-v1", launchGate: "native-structured-identity-before-prompt", hardLimit: 10, observedWorkTokens: 0 });
    await expect(inspectCliTokenBudget(f.store, undefined, query)).rejects.toThrow("unavailable");
    f.task.tokenBudgetOverride.hard = 0;
    await expect(inspectCliTokenBudget(f.store, f.sessions, query)).rejects.toThrow("positive");
    f.task.tokenBudgetOverride.hard = 10;
    await expect(inspectCliTokenBudget(f.store, f.sessions, { ...query, admission: { ...admission, leaseEpoch: 2 } })).rejects.toThrow("admission");
  });
  it("requires exact admitted persisted session proof and returns its drain phase", async () => {
    const f = fixture();
    await expect(inspectCliTokenBudget(f.store, f.sessions, { ...query, sessionId: "record" })).rejects.toThrow();
    f.task.sourceMetadata.cliTokenUsage = { version: 1, sessions: { "codex:conversation": {} }, credits: { "codex:conversation": { inputTokens: 2, outputTokens: 1, cachedTokens: 100, cacheWriteTokens: 1 } }, cursors: { "codex:conversation": { bytes: 100, fileIdentity: "1:2", phase: "drained" } }, owners: { "codex:conversation": { sessionId: "record", ...admission } } };
    expect(await inspectCliTokenBudget(f.store, f.sessions, { ...query, sessionId: "record" })).toMatchObject({ session: { sessionId: "record", nativeSessionId: "conversation", phase: "drained", workTokens: 4 } });
    f.task.sourceMetadata.cliTokenUsage.owners["codex:conversation"].leaseEpoch = 2;
    await expect(inspectCliTokenBudget(f.store, f.sessions, { ...query, sessionId: "record" })).rejects.toThrow("proof");
  });  it("exposes only complete drained current-turn evidence without breaking legacy credits", async () => {
    const f = fixture(), key = "codex:conversation";
    const identity = { selected: { model: "gpt-a", provider: "openai", source: "codex-thread-start" }, observed: { model: "gpt-a", provider: "openai", source: "codex-turn-context" }, coverage: "complete" };
    const ledger = { version: 1, sessions: { [key]: {} }, credits: { [key]: { inputTokens: 5, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 } }, owners: { [key]: { sessionId: "record", ...admission } }, cursors: { [key]: { bytes: 100, fileIdentity: "1:2", phase: "drained" } }, identities: { [key]: identity } };
    f.task.sourceMetadata.cliTokenUsage = ledger;
    const read = () => inspectCliTokenBudget(f.store, f.sessions, { ...query, sessionId: "record" });
    expect((await read()).session?.identity).toEqual(identity);
    ledger.identities[key].coverage = "incomplete";
    expect((await read()).session).toMatchObject({ workTokens: 5 });
    expect((await read()).session?.identity).toBeUndefined();
    ledger.identities[key].coverage = "complete"; ledger.cursors[key].phase = "failed";
    expect((await read()).session?.identity).toBeUndefined();
    delete (ledger as any).identities;
    expect((await read()).session).toMatchObject({ workTokens: 5, phase: "failed" });
  });

});
