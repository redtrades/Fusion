import type { Task } from "@fusion/core";

/** FNXC:TerminalBoard 2026-09-14-04:18: Display groups preserve native Task references and WIP occupancy. A stale summary cannot move a card, even visually. */
export function terminalDisplayKind(task: Task): "blocked" | "escalated" | undefined {
  const display = task.terminalDisplay;
  return display && !task.deletedAt && task.paused === true && task.status === "paused"
    && display.originColumn === task.column && display.taskRevision === task.updatedAt
    && (display.kind === "blocked" || display.kind === "escalated") ? display.kind : undefined;
}

export function terminalDisplayGroups(tasks: Task[]): { kind: "blocked" | "escalated"; tasks: Task[] }[] {
  const seen = new Set<string>();
  const groups = { blocked: [] as Task[], escalated: [] as Task[] };
  for (const task of tasks) {
    const kind = terminalDisplayKind(task);
    if (kind && !seen.has(task.id)) { groups[kind].push(task); seen.add(task.id); }
  }
  return (["blocked", "escalated"] as const).filter(kind => groups[kind].length > 0).map(kind => ({ kind, tasks: groups[kind] }));
}
