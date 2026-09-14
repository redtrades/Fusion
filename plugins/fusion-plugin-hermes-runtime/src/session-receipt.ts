import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hermesProfileHome } from "./cli-spawn.js";
import { resolveHermesLaunch } from "./windows-binary-launch.js";

/** Reported session-row totals, not per-turn usage, model attestation, or an enforcement receipt. */
export interface HermesSessionReceipt {
  readonly schema: "hermes-session-export-v1";
  readonly sessionId: string;
  readonly scope: "session-cumulative";
  readonly reportedModel: string;
  readonly reportedProvider: string;
  readonly usage: Readonly<{ inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>;
}
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;
const exactId = (id: string): boolean => /^[0-9]{8}_[0-9]{6}_[0-9a-f]{6}$/.test(id);

/** Only selected metadata escapes this function; malformed output is never included in errors. */
export function parseHermesSessionReceipt(text: string, sessionId: string): HermesSessionReceipt {
  try {
    if (!exactId(sessionId) || Buffer.byteLength(text) > MAX_EXPORT_BYTES) throw new Error();
    const row = JSON.parse(text) as Record<string, unknown>;
    if (row.id !== sessionId) throw new Error(); // The upstream CLI accepts prefixes; this seam does not.
    for (const field of ["model", "billing_provider"]) {
      if (typeof row[field] !== "string" || !row[field].trim() || row[field].length > 256) throw new Error();
    }
    const counter = (key: string): number => {
      const value = row[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error();
      return value;
    };
    return Object.freeze({ schema: "hermes-session-export-v1", sessionId, scope: "session-cumulative",
      reportedModel: row.model as string, reportedProvider: row.billing_provider as string,
      usage: Object.freeze({ inputTokens: counter("input_tokens"), outputTokens: counter("output_tokens"),
        cacheReadTokens: counter("cache_read_tokens"), cacheWriteTokens: counter("cache_write_tokens") }),
    });
  } catch { throw new Error("Hermes session receipt invalid or incomplete"); }
}

/**
 * Read the already completed native session through the supported CLI; no inference or database owner.
 * An aborted supplied signal rejects with name "AbortError" and a fixed message, never signal.reason.
 * Other failures reject with a generic sanitized Error; no child diagnostics are exposed.
 */
export async function readHermesSessionReceipt(
  settings: { binaryPath: string; profile?: string }, sessionId: string, signal?: AbortSignal,
): Promise<HermesSessionReceipt> {
  try {
    if (!exactId(sessionId)) throw new Error();
    signal?.throwIfAborted();
    const env = { ...process.env };
    if (settings.profile) env.HERMES_HOME = hermesProfileHome(settings.profile);
    const args = ["sessions", "export", "-", "--format", "jsonl", "--session-id", sessionId, "--redact"];
    const launch = await resolveHermesLaunch(settings.binaryPath, args, { env });
    signal?.throwIfAborted();
    const { stdout } = await promisify(execFile)(launch.command, launch.args, {
      env, signal, timeout: 10000, killSignal: "SIGKILL", maxBuffer: MAX_EXPORT_BYTES, encoding: "utf8",
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    signal?.throwIfAborted();
    return parseHermesSessionReceipt(stdout, sessionId);
  } catch {
    if (signal?.aborted) {
      const error = new Error("Hermes session receipt aborted");
      error.name = "AbortError";
      throw error;
    }
    throw new Error("Hermes session receipt unavailable");
  }
}
