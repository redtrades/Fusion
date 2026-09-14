import type { Task, TaskStore } from "@fusion/core";

/** FNXC:TerminalBoard 2026-09-14-04:18: Only the native transactional reader can establish a current hold. Bound concurrent reads and refuse mismatched snapshots; historical metadata is never display authority. */
export async function enrichTaskTerminalDisplays<T extends Task>(store: Pick<TaskStore, "readWorkflowOverlayCurrentTerminal">, tasks: T[]): Promise<T[]> {
  const rows = tasks.map(({ terminalDisplay: _discard, ...row }) => row as T);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      const row = rows[index];
      if (!row.paused || row.status !== "paused" || row.deletedAt) continue;
      try {
        const result = await store.readWorkflowOverlayCurrentTerminal(row.id);
        if (!result.current || result.task.id !== row.id || result.task.updatedAt !== row.updatedAt
          || result.task.column !== row.column || !result.task.paused || result.task.status !== "paused") continue;
        const { terminalBlock: block, terminal } = result;
        const kind = block.reason === "missing-input" || block.reason === "dependency-down" ? "blocked"
          : block.reason === "gate-failed-final" || block.reason === "validation-inconclusive" || block.reason === "merge-manual-required" ? "escalated"
          : block.reason === "operator-hold" && (block.operatorColumn === "blocked" || block.operatorColumn === "escalated") ? block.operatorColumn : undefined;
        if (!kind || block.resumeActor !== (kind === "blocked" ? "orchestrator" : "human")) continue;
        rows[index] = { ...row, terminalDisplay: { kind, reason: block.reason as string,
          resumeActor: block.resumeActor as "orchestrator" | "human", originColumn: row.column,
          anchorId: terminal.heldWorkItemId, runId: terminal.graphRunId, taskRevision: row.updatedAt } };
      } catch {
        // FNXC:TerminalBoard 2026-09-14-04:18: Unavailable evidence leaves the paused task in its actual phase.
      }
    }
  }));
  return rows;
}
