import { isDeepStrictEqual } from "node:util";
import { and, eq, isNull } from "drizzle-orm";
import type { TaskStore } from "../store.js";
import type { Task } from "../types.js";
import * as schema from "../postgres/schema/index.js";
import { taskProjectScope } from "../postgres/data-layer.js";
import { readTaskRowInTransaction } from "./async/async-persistence.js";
import { acquireTaskAdvisoryXactLock } from "./task-advisory-lock.js";
import { advanceCliTokenLedger, validateCliTokenLedger, CLI_TOKEN_FIELDS, emptyCliTokenCounters, validateCliTokenCursor, validateCliObservedIdentity, type CliObservedIdentity, type CliTokenCursor, type CliTokenCounters, type CliTokenLedger } from "../cli/cli-token-usage-types.js";

export interface CliTokenUsageWrite {
  identity?: CliObservedIdentity;
  sessionId: string;
  nativeSessionId: string;
  projectId: string;
  admission: { runId: string; leaseEpoch: number; agentId: string; nodeId: string };
  observations: Array<{ key: string; usage: CliTokenCounters }>;
  baseline: boolean;
  cursor: CliTokenCursor;
  /** Fresh native handshake admission, never a replay or resumed baseline. */
  fresh?: boolean;
  /** Recheck the exact pending owner and current totals before first dispatch. */
  reaffirm?: true;
  limits: { soft?: number; hard?: number };
}
export interface CliTokenUsageAck { task: Task; hardExceeded: boolean; observedWorkTokens: number }

/**
 * FNXC:CliTokenBudget 2026-09-14-02:47: Ledger, aggregate and hard pause commit in
 * one task transaction, fenced against Reset/lease changes. Never use the
 * process-only updateTaskAtomic path for durable replay checkpoints.
 */
export async function recordCliTokenUsageFencedImpl(store: TaskStore, id: string, input: CliTokenUsageWrite): Promise<CliTokenUsageAck> {
  const request = structuredClone(input);
  const layer = store.asyncLayer;
  if (!layer?.projectId) throw new Error("CLI token persistence unavailable");
  if (request.projectId !== layer.projectId) throw new Error("CLI token project mismatch");
  if (!request.sessionId || !request.nativeSessionId || !request.projectId || !request.admission?.runId || !request.admission.agentId || !request.admission.nodeId || !Number.isSafeInteger(request.admission.leaseEpoch) || request.admission.leaseEpoch < 1 || !Array.isArray(request.observations) || request.observations.length > 4096 || !Number.isSafeInteger(request.cursor?.bytes) || request.cursor.bytes < 0 || typeof request.baseline !== "boolean" || Object.values(request.limits).some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) throw new Error("Invalid CLI token request");
  validateCliTokenCursor(request.cursor);
  if (request.identity) validateCliObservedIdentity(request.identity);
  if (request.reaffirm !== undefined && request.reaffirm !== true) throw new Error("Invalid CLI pending reaffirmation");
  if (request.fresh !== undefined && request.fresh !== true) throw new Error("Invalid CLI fresh admission");
  return store.withTaskLock(id, async () => {
    const ack = await layer.transactionImmediate(async tx => {
      await acquireTaskAdvisoryXactLock(tx, layer.projectId, id);
      await tx.select({ id: schema.project.tasks.id }).from(schema.project.tasks).where(and(eq(schema.project.tasks.id, id), taskProjectScope(layer))).for("update");
      const row = await readTaskRowInTransaction(tx, id, { includeDeleted: true }, layer.projectId);
      if (!row || row.deletedAt) throw new Error("CLI token task unavailable");
      const task = store.rowToTask(store.pgRowToTaskRow(row));
      const a = request.admission;
      if (task.checkoutRunId !== a.runId || task.checkoutLeaseEpoch !== a.leaseEpoch || task.checkedOutBy !== a.agentId || task.checkoutNodeId !== a.nodeId) throw new Error("CLI token ownership mismatch");
      const [session] = await tx.select().from(schema.project.cliSessions).where(and(eq(schema.project.cliSessions.id, request.sessionId), eq(schema.project.cliSessions.ownerProjectId, request.projectId))).for("share");
      if (!session || session.taskId !== id || session.nativeSessionId !== request.nativeSessionId || !["codex", "claude-code"].includes(session.adapterId)) throw new Error("CLI token native session identity mismatch");
      const key = `${session.adapterId}:${request.nativeSessionId}`;
      let ledger = task.sourceMetadata?.cliTokenUsage as CliTokenLedger | undefined;
      if (ledger !== undefined) validateCliTokenLedger(ledger);
      const previousCursor = ledger?.cursors?.[key];
      const previousOwner = ledger?.owners?.[key];
      if (previousOwner && (previousOwner.sessionId !== request.sessionId || previousOwner.runId !== a.runId || previousOwner.leaseEpoch !== a.leaseEpoch || previousOwner.agentId !== a.agentId || previousOwner.nodeId !== a.nodeId)) throw new Error("CLI token stream owner changed");
      if (request.reaffirm) {
        if (request.fresh || session.adapterId !== "codex" || !previousOwner || previousCursor?.phase !== "awaiting-file" || request.baseline || request.observations.length || request.cursor.phase !== "awaiting-file" || request.cursor.bytes !== 0 || request.cursor.fileIdentity !== undefined || request.cursor.transcriptPath !== previousCursor.transcriptPath) throw new Error("Invalid CLI pending reaffirmation");
      } else if (request.fresh) {
        if (session.adapterId !== "codex" || Object.hasOwn(ledger?.sessions ?? {}, key) || request.baseline || request.observations.length || request.cursor.phase !== "awaiting-file" || request.cursor.fileIdentity !== undefined) throw new Error("CLI fresh admission already used or invalid");
      } else if (request.cursor.transcriptPath && !previousCursor) throw new Error("CLI native future stream lacks admission");
      else if (request.cursor.phase === "awaiting-file") throw new Error("CLI pending cursor requires fresh admission");
      if (previousCursor?.phase === "failed" && request.cursor.phase !== "failed") throw new Error("Failed CLI token cursor cannot resume");
      if (previousCursor) {
        if (previousCursor.transcriptPath !== request.cursor.transcriptPath || (previousCursor.fileIdentity && previousCursor.fileIdentity !== request.cursor.fileIdentity) || request.cursor.bytes < previousCursor.bytes || (previousCursor.phase === "awaiting-file" && !request.reaffirm && (request.baseline || !request.cursor.fileIdentity))) throw new Error("CLI token stream identity changed");
      }

      const oldIdentity = ledger?.identities?.[key];
      const nextIdentity = request.identity ?? (oldIdentity && (request.baseline || request.observations.length) ? { ...oldIdentity, coverage: "incomplete" as const } : oldIdentity);
      if (request.identity && ((oldIdentity?.selected && !isDeepStrictEqual(oldIdentity.selected, request.identity.selected))
        || (oldIdentity?.observed && !isDeepStrictEqual(oldIdentity.observed, request.identity.observed))
        || (oldIdentity?.coverage === "incomplete" && request.identity.coverage !== "incomplete"))) throw new Error("CLI observed identity changed");
      if (nextIdentity?.selected && session.adapterId !== "codex") throw new Error("CLI selected identity adapter mismatch");
      if (nextIdentity?.observed && nextIdentity.observed.source !== (session.adapterId === "codex" ? "codex-turn-context" : "claude-assistant-message")) throw new Error("CLI observed identity adapter mismatch");
      const baseline = request.baseline && !Object.hasOwn(ledger?.sessions ?? {}, key);
      const delta = emptyCliTokenCounters();
      for (const observation of request.observations) {
        const next = advanceCliTokenLedger(ledger, key, observation.key, observation.usage, baseline);
        ledger = next.ledger;
        for (const field of CLI_TOKEN_FIELDS) delta[field] += next.delta[field];
      }
      // An empty baseline still binds this native stream before prompt injection.
      ledger ??= { version: 1, sessions: {} };
      ledger.sessions[key] ??= {};
      const credited = { ...(ledger.credits?.[key] ?? emptyCliTokenCounters()) };
      for (const field of CLI_TOKEN_FIELDS) credited[field] += delta[field];
      const checkpoint = { ...ledger, ...(nextIdentity ? { identities: { ...ledger.identities, [key]: nextIdentity } } : {}), credits: { ...ledger.credits, [key]: credited }, owners: { ...ledger.owners, [key]: { sessionId: request.sessionId, ...request.admission } }, cursors: { ...(ledger.cursors ?? {}), [key]: request.cursor } };
      validateCliTokenLedger(checkpoint);
      const totals = emptyCliTokenCounters();
      for (const field of CLI_TOKEN_FIELDS) {
        totals[field] = (task.tokenUsage?.[field] ?? 0) + delta[field];
        if (!Number.isSafeInteger(totals[field])) throw new Error("CLI token total overflow");
      }
      const totalTokens = CLI_TOKEN_FIELDS.reduce((sum, field) => sum + totals[field], 0);
      if (!Number.isSafeInteger(totalTokens)) throw new Error("CLI token total overflow");
      const work = totals.inputTokens + totals.outputTokens + totals.cacheWriteTokens;
      const hardExceeded = request.limits.hard !== undefined && work >= request.limits.hard;
      if (hardExceeded) checkpoint.cursors[key] = { ...request.cursor, phase: "failed" };
      const now = new Date().toISOString();
      const [updated] = await tx.update(schema.project.tasks).set({
        sourceMetadata: { ...task.sourceMetadata, cliTokenUsage: checkpoint },
        tokenUsageInputTokens: totals.inputTokens, tokenUsageOutputTokens: totals.outputTokens,
        tokenUsageCachedTokens: totals.cachedTokens, tokenUsageCacheWriteTokens: totals.cacheWriteTokens,
        tokenUsageTotalTokens: totalTokens, tokenUsageFirstUsedAt: task.tokenUsage?.firstUsedAt ?? now,
        tokenUsageLastUsedAt: now, updatedAt: now,
        ...(hardExceeded ? { paused: 1, pausedReason: "token_budget_exceeded", tokenBudgetHardAlertedAt: task.tokenBudgetHardAlertedAt ?? now } : {}),
      }).where(and(eq(schema.project.tasks.id, id), taskProjectScope(layer), isNull(schema.project.tasks.deletedAt))).returning();
      if (!updated) throw new Error("CLI token task unavailable");
      return { task: store.rowToTask(store.pgRowToTaskRow(updated)), hardExceeded, observedWorkTokens: work };
    });
    await store.writeTaskJsonFile(store.taskDir(id), ack.task);
    if (store.isWatching) store.taskCache.set(id, { ...ack.task });
    store.emitTaskLifecycleEventSafely("task:updated", [ack.task]);
    return ack;
  });
}
