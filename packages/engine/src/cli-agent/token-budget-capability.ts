import { validateCliTokenLedger } from "@fusion/core";
import type { CliSessionStore, CliTokenBudgetInspection, CliTokenBudgetQuery, CliTokenLedger, GlobalSettings, ProjectSettings, TaskStore } from "@fusion/core";
import { getTokenBudgetUsage, resolveTaskTokenBudget } from "../concurrency/token-budget-enforcer.js";
/** Read current native admission/config; hook trust is proved by launch, never this query. */
export async function inspectCliTokenBudget(store: TaskStore, sessions: CliSessionStore | undefined, input: CliTokenBudgetQuery): Promise<CliTokenBudgetInspection> {
  input = structuredClone(input);
  if (!sessions || !["codex", "claude-code"].includes(input.adapterId)) throw new Error("Native CLI accounting unavailable");
  const [task, settings] = await Promise.all([store.getTask(input.taskId), store.getSettingsByScope()]);
  const a = input.admission;
  if (!a || task.checkoutRunId !== a.runId || task.checkoutLeaseEpoch !== a.leaseEpoch || task.checkedOutBy !== a.agentId || task.checkoutNodeId !== a.nodeId) throw new Error("Native CLI accounting admission mismatch");
  const { hard } = resolveTaskTokenBudget(task, settings.project as ProjectSettings, settings.global as GlobalSettings);
  if (!Number.isSafeInteger(hard) || hard! <= 0) throw new Error("Native CLI accounting requires a finite positive hard budget");
  const result: CliTokenBudgetInspection = { protocol: "native-cli-observed-v1", hardLimit: hard!, observedWorkTokens: getTokenBudgetUsage(task.tokenUsage), launchGate: input.adapterId === "codex" ? "native-structured-identity-before-prompt" : "authenticated-identity-before-prompt" };
  if (input.sessionId) {
    await sessions.flush();
    const session = sessions.getSession(input.sessionId);
    const projectId = store.getProjectId();
    if (!session || session.taskId !== task.id || session.projectId !== projectId || session.adapterId !== input.adapterId || !session.nativeSessionId) throw new Error("Native CLI accounting session mismatch");
    const key = `${input.adapterId}:${session.nativeSessionId}`;
    const ledger = task.sourceMetadata?.cliTokenUsage as CliTokenLedger | undefined;
    validateCliTokenLedger(ledger);
    const owner = ledger?.owners?.[key], cursor = ledger?.cursors?.[key], credits = ledger?.credits?.[key];
    if (!owner || !cursor || !credits || owner.sessionId !== input.sessionId || owner.runId !== a.runId || owner.leaseEpoch !== a.leaseEpoch || owner.agentId !== a.agentId || owner.nodeId !== a.nodeId) throw new Error("Native CLI accounting proof unavailable");
    result.session = { sessionId: session.id, nativeSessionId: session.nativeSessionId, phase: cursor.phase, workTokens: credits.inputTokens + credits.outputTokens + credits.cacheWriteTokens };
  }
  return result;
}
