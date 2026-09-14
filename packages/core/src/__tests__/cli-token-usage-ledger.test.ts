import { describe, expect, it } from "vitest";
import { advanceCliTokenLedger } from "../cli/cli-token-usage-types.js";
const usage = (inputTokens: number) => ({ inputTokens, outputTokens: 0, cachedTokens: 1000, cacheWriteTokens: 0 });
describe("durable CLI usage ledger", () => {
  it("replays cumulative snapshots and combines different native sessions", () => {
    const a = advanceCliTokenLedger(undefined, "codex:a", "cumulative", usage(10), false);
    expect(a.delta.inputTokens).toBe(10);
    const replay = advanceCliTokenLedger(JSON.parse(JSON.stringify(a.ledger)), "codex:a", "cumulative", usage(10), false);
    expect(replay.delta.inputTokens).toBe(0);
    const next = advanceCliTokenLedger(replay.ledger, "codex:a", "cumulative", usage(15), false);
    expect(next.delta.inputTokens).toBe(5);
    expect(advanceCliTokenLedger(next.ledger, "codex:b", "cumulative", usage(7), false).delta.inputTokens).toBe(7);
  });
  it("baselines preexisting history and deduplicates Claude message updates", () => {
    const baseline = advanceCliTokenLedger(undefined, "claude-code:a", "m1", usage(10), true);
    expect(baseline.delta.inputTokens).toBe(0);
    const updated = advanceCliTokenLedger(baseline.ledger, "claude-code:a", "m1", usage(12), false);
    expect(updated.delta.inputTokens).toBe(2);
    expect(advanceCliTokenLedger(updated.ledger, "claude-code:a", "m2", usage(8), false).delta.inputTokens).toBe(8);
    expect(advanceCliTokenLedger(updated.ledger, "claude-code:a", "m1", usage(11), false).delta.inputTokens).toBe(0);
  });
  it("refuses invalid checkpoints and overflow instead of silently resetting", () => {
    expect(() => advanceCliTokenLedger({ version: 99 }, "codex:a", "cumulative", usage(1), false)).toThrow();
    expect(() => advanceCliTokenLedger(undefined, "codex:a", "cumulative", usage(Infinity), false)).toThrow();
  });
});
