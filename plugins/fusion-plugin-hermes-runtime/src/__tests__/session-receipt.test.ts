import { describe, expect, it } from "vitest";
import { parseHermesSessionReceipt, readHermesSessionReceipt } from "../session-receipt.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const id = "20260427_120000_abc123";
const row = { id, model: "model-reported", billing_provider: "nous", input_tokens: 20, output_tokens: 3, cache_read_tokens: 10, cache_write_tokens: 2, messages: [{ content: "NEVER RETURN TRANSCRIPT" }] };

describe("exact Hermes session receipt", () => {
  it("retains cumulative native counters without inventing per-turn or model provenance", () => {
    const result = parseHermesSessionReceipt(JSON.stringify(row), id);
    expect(result).toEqual({ schema: "hermes-session-export-v1", sessionId: id, scope: "session-cumulative", reportedModel: "model-reported", reportedProvider: "nous", usage: { inputTokens: 20, outputTokens: 3, cacheReadTokens: 10, cacheWriteTokens: 2 } });
    expect(JSON.stringify(result)).not.toContain("TRANSCRIPT");
  });
  it.each([ { ...row, id: id + "other" }, { ...row, input_tokens: -1 }, { ...row, cache_read_tokens: undefined }, { ...row, output_tokens: Number.MAX_SAFE_INTEGER + 1 }, { ...row, model: "" } ])("rejects unverifiable identity or counter metadata", bad => {
    expect(() => parseHermesSessionReceipt(JSON.stringify(bad), id)).toThrow("Hermes session receipt");
  });
  it("rejects multiple rows and malformed JSON without reflecting output", () => {
    for (const text of [JSON.stringify(row) + "\n" + JSON.stringify(row), "SECRET invalid json"]) {
      expect(() => parseHermesSessionReceipt(text, id)).toThrow("Hermes session receipt");
      try { parseHermesSessionReceipt(text, id); } catch (error) { expect(String(error)).not.toContain("SECRET"); }
    }
  });
  it("uses exact redacted export command with bounded subprocess output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hermes-receipt-test-"));
    try {
      const binary = join(dir, "receipt-fixture");
      await writeFile(binary, `#!/usr/bin/env node\nconst args = process.argv.slice(2); if (JSON.stringify(args) !== ${JSON.stringify(JSON.stringify(["sessions", "export", "-", "--format", "jsonl", "--session-id", id, "--redact"]))}) process.exit(3); process.stdout.write(${JSON.stringify(JSON.stringify(row))});`, { mode: 0o700 });
      expect((await readHermesSessionReceipt({ binaryPath: binary }, id)).sessionId).toBe(id);
      await writeFile(binary, `#!/usr/bin/env node\nprocess.stdout.write('SENSITIVE'.repeat(600000));`, { mode: 0o700 });
      await expect(readHermesSessionReceipt({ binaryPath: binary }, id)).rejects.toThrow("Hermes session receipt unavailable");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});


it("cancels an active receipt export without exposing child output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "receipt-cancel-test-"));
  try {
    const binary = join(dir, "receipt-fixture");
    const marker = join(dir, "started");
    await writeFile(binary, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ready'); process.stderr.write('PRIVATE DIAGNOSTIC'); setInterval(() => {}, 1000);`, { mode: 0o700 });
    const controller = new AbortController();
    const pending = readHermesSessionReceipt({ binaryPath: binary }, id, controller.signal);
    const rejection = pending.catch(error => {
      expect(error).toMatchObject({ name: "AbortError", message: "Hermes session receipt aborted" });
      expect(error.cause).toBeUndefined();
      expect(String(error)).not.toContain("PRIVATE");
      return error;
    });
    let started = false;
    for (let tries = 0; tries < 100; tries++) {
      try { started = await readFile(marker, "utf8") === "ready"; } catch {}
      if (started) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    controller.abort(new Error("PRIVATE ABORT REASON"));
    expect(await rejection).toBeInstanceOf(Error);
    expect(started).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


it("refuses a pre-aborted export before launching a child and hides its reason", async () => {
  const dir = await mkdtemp(join(tmpdir(), "receipt-preabort-test-"));
  try {
    const binary = join(dir, "receipt-fixture");
    const marker = join(dir, "started");
    await writeFile(binary, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');`, { mode: 0o700 });
    const controller = new AbortController();
    controller.abort(new Error("PRIVATE ABORT REASON"));
    const error = await readHermesSessionReceipt({ binaryPath: binary }, id, controller.signal).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "AbortError", message: "Hermes session receipt aborted" });
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toContain("PRIVATE");
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("keeps malformed subprocess exports distinct from cancellation without exposing diagnostics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "receipt-malformed-test-"));
  try {
    const binary = join(dir, "receipt-fixture");
    await writeFile(binary, `#!/usr/bin/env node\nprocess.stderr.write('PRIVATE DIAGNOSTIC'); process.stdout.write('PRIVATE INVALID JSON');`, { mode: 0o700 });
    const error = await readHermesSessionReceipt({ binaryPath: binary }, id, new AbortController().signal).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "Error", message: "Hermes session receipt unavailable" });
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toContain("PRIVATE");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
