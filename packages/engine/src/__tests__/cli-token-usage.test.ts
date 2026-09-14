import { describe, expect, it } from "vitest";
import { parseCliTokenUsage } from "../cli-agent/token-usage.js";

describe("native CLI usage normalization", () => {
  it("counts Codex uncached input without counting reasoning output twice", () => {
    expect(parseCliTokenUsage("codex", { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 61792456, cached_input_tokens: 60634496, cache_write_input_tokens: 0, output_tokens: 107055, reasoning_output_tokens: 33153, total_tokens: 61899511 } } } })).toEqual({ key: "cumulative", usage: { inputTokens: 1157960, outputTokens: 107055, cachedTokens: 60634496, cacheWriteTokens: 0 } });
  });
  it("uses Claude message identity for repeated snapshots and treats cache details as subsets", () => {
    expect(parseCliTokenUsage("claude-code", { type: "assistant", message: { id: "message-1", usage: { input_tokens: 2, cache_creation_input_tokens: 3113, cache_read_input_tokens: 440378, output_tokens: 1131, output_tokens_details: { thinking_tokens: 0 }, cache_creation: { ephemeral_1h_input_tokens: 3113, ephemeral_5m_input_tokens: 0 } } } })).toEqual({ key: "message-1", usage: { inputTokens: 2, outputTokens: 1131, cachedTokens: 440378, cacheWriteTokens: 3113 } });
  });
  it("ignores nonusage rows but rejects malformed identified usage", () => {
    expect(parseCliTokenUsage("codex", { type: "response_item" })).toBeNull();
    expect(() => parseCliTokenUsage("codex", { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1, cached_input_tokens: 2, output_tokens: 1 } } } })).toThrow();
    expect(() => parseCliTokenUsage("claude-code", { type: "assistant", message: { usage: { input_tokens: 1, output_tokens: 1 } } })).toThrow();
  });
});
