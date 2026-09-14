import type { CliTokenCounters } from "@fusion/core";
export interface CliTokenObservation { key: string; usage: CliTokenCounters }
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const counter = (row: Record<string, unknown>, key: string, optional = false): number => {
  const value = row[key] ?? (optional ? 0 : undefined);
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Invalid CLI usage counter: ${key}`);
  return value as number;
};
/** FNXC:CliTokenBudget 2026-09-14-02:47: Parse versioned usage only; no prompt/output capture. */
export function parseCliTokenUsage(adapter: string, value: unknown): CliTokenObservation | null {
  const row = object(value);
  if (!row) return null;
  if (adapter === "codex") {
    const payload = object(row.payload);
    if (row.type !== "event_msg" || payload?.type !== "token_count") return null;
    const info = object(payload.info);
    // Native token_count with null info is a rate-limit-only update, not usage.
    if (payload.info === null) return null;
    const usage = object(info?.total_token_usage);
    if (!usage) throw new Error("Invalid Codex cumulative usage");
    const input = counter(usage, "input_tokens"), cached = counter(usage, "cached_input_tokens");
    if (cached > input) throw new Error("Invalid Codex cached input subset");
    return { key: "cumulative", usage: { inputTokens: input - cached, cachedTokens: cached, outputTokens: counter(usage, "output_tokens"), cacheWriteTokens: counter(usage, "cache_write_input_tokens", true) } };
  }
  if (adapter === "claude-code") {
    const message = object(row.message);
    if (row.type !== "assistant" || message?.usage === undefined) return null;
    const usage = object(message.usage);
    if (!usage || typeof message.id !== "string" || !message.id) throw new Error("Invalid Claude message usage identity");
    return { key: message.id, usage: { inputTokens: counter(usage, "input_tokens"), outputTokens: counter(usage, "output_tokens"), cachedTokens: counter(usage, "cache_read_input_tokens", true), cacheWriteTokens: counter(usage, "cache_creation_input_tokens", true) } };
  }
  throw new Error("CLI token usage adapter unsupported");
}
