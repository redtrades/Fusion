/** Native-issued future paths carry no invented inode. Binding is one-way. */
export interface CliTokenCursor {
  bytes: number;
  fileIdentity?: string;
  transcriptPath?: string;
  phase: "awaiting-file" | "baseline" | "observing" | "drained" | "failed";
}
export function validateCliTokenCursor(cursor: CliTokenCursor): void {
  if (!cursor || !Number.isSafeInteger(cursor.bytes) || cursor.bytes < 0 || !["awaiting-file", "baseline", "observing", "drained", "failed"].includes(cursor.phase)) throw new Error("Invalid CLI token cursor");
  if (cursor.transcriptPath !== undefined && (typeof cursor.transcriptPath !== "string" || !cursor.transcriptPath.startsWith("/") || cursor.transcriptPath.length > 4096)) throw new Error("Invalid CLI token path");
  if (cursor.fileIdentity === undefined) {
    if (cursor.bytes !== 0 || !cursor.transcriptPath || !["awaiting-file", "failed"].includes(cursor.phase)) throw new Error("Invalid pending CLI token cursor");
  } else if (typeof cursor.fileIdentity !== "string" || !cursor.fileIdentity || cursor.fileIdentity.length > 256 || cursor.phase === "awaiting-file") throw new Error("Invalid bound CLI token cursor");
}
/** FNXC:CliTokenBudget 2026-09-14-02:47: Work counters exclude cache reads. */
export interface CliTokenCounters {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
}
export interface CliTokenLedger {
  version: 1;
  credits?: Record<string, CliTokenCounters>;
  owners?: Record<string, { sessionId: string; runId: string; leaseEpoch: number; agentId: string; nodeId: string }>;
  cursors?: Record<string, CliTokenCursor>;
  sessions: Record<string, Record<string, CliTokenCounters>>;
}
export const CLI_TOKEN_FIELDS = ["inputTokens", "outputTokens", "cachedTokens", "cacheWriteTokens"] as const;
export const emptyCliTokenCounters = (): CliTokenCounters => ({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 });
export function validateCliTokenCounters(value: unknown): asserts value is CliTokenCounters {
  if (!value || typeof value !== "object" || CLI_TOKEN_FIELDS.some(key => !Number.isSafeInteger((value as CliTokenCounters)[key]) || (value as CliTokenCounters)[key] < 0)) throw new Error("Invalid CLI token counters");
}
export function validateCliTokenLedger(value: unknown): asserts value is CliTokenLedger {
  const ledger = value as CliTokenLedger;
  if (!ledger || ledger.version !== 1 || !ledger.sessions || typeof ledger.sessions !== "object" || Array.isArray(ledger.sessions)) throw new Error("Invalid CLI token ledger");
  let count = 0;
  for (const messages of Object.values(ledger.sessions)) {
    if (!messages || typeof messages !== "object" || Array.isArray(messages)) throw new Error("Invalid CLI token ledger");
    for (const usage of Object.values(messages)) { validateCliTokenCounters(usage); count++; }
  }
  for (const usage of Object.values(ledger.credits ?? {})) validateCliTokenCounters(usage);
  for (const cursor of Object.values(ledger.cursors ?? {})) {
    validateCliTokenCursor(cursor);
  }
  if (count > 4096 || Buffer.byteLength(JSON.stringify(ledger)) > 1024 * 1024) throw new Error("CLI token ledger capacity reached");
}

/** Pure, bounded, replay-safe update; the caller commits ledger and delta atomically. */
export function advanceCliTokenLedger(raw: unknown, sessionKey: string, eventKey: string, usage: CliTokenCounters, baseline: boolean): { ledger: CliTokenLedger; delta: CliTokenCounters } {
  validateCliTokenCounters(usage);
  if (!sessionKey || sessionKey.length > 256 || !eventKey || eventKey.length > 256 || [sessionKey, eventKey].some(key => ["__proto__", "constructor", "prototype"].includes(key))) throw new Error("Invalid CLI usage identity");
  const ledger: CliTokenLedger = raw === undefined ? { version: 1, sessions: {} } : structuredClone(raw) as CliTokenLedger;
  validateCliTokenLedger(ledger);
  let entries = 0;
  for (const session of Object.values(ledger.sessions)) {
    if (!session || typeof session !== "object" || Array.isArray(session)) throw new Error("Invalid CLI token ledger");
    for (const counters of Object.values(session)) { validateCliTokenCounters(counters); entries++; }
  }
  const sessions = Object.hasOwn(ledger.sessions, sessionKey) ? ledger.sessions[sessionKey]! : {};
  const old = Object.hasOwn(sessions, eventKey) ? sessions[eventKey]! : emptyCliTokenCounters();
  const delta = emptyCliTokenCounters(), next = emptyCliTokenCounters();
  for (const key of CLI_TOKEN_FIELDS) {
    next[key] = Math.max(old[key], usage[key]);
    delta[key] = baseline ? 0 : next[key] - old[key];
  }
  if (!Object.hasOwn(sessions, eventKey) && entries >= 4096) throw new Error("CLI token ledger capacity reached");
  ledger.sessions[sessionKey] = { ...sessions, [eventKey]: next };
  if (Buffer.byteLength(JSON.stringify(ledger)) > 1024 * 1024) throw new Error("CLI token ledger capacity reached");
  return { ledger, delta };
}

export interface CliTokenBudgetQuery {
  taskId: string;
  adapterId: "codex" | "claude-code";
  admission: { runId: string; leaseEpoch: number; agentId: string; nodeId: string };
  sessionId?: string;
}
export interface CliTokenBudgetInspection {
  protocol: "native-cli-observed-v1";
  hardLimit: number;
  observedWorkTokens: number;
  launchGate: "authenticated-identity-before-prompt" | "native-structured-identity-before-prompt";
  session?: { sessionId: string; nativeSessionId: string; phase: CliTokenCursor["phase"]; workTokens: number };
}
