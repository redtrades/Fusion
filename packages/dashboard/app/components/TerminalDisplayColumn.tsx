import type { Task } from "@fusion/core";

/** FNXC:TerminalBoard 2026-09-14-04:18: Main-Board terminal lanes are read-only projections. No drag, lifecycle target, bulk control or Resume authority is attached; details receive the original task. */
export function TerminalDisplayColumn({ kind, tasks, onOpenDetail }: { kind: "blocked" | "escalated"; tasks: Task[]; onOpenDetail: (task: Task) => void }) {
  const title = kind === "blocked" ? "Blocked" : "Escalated";
  return <section className="column" role="region" aria-label={title} data-terminal-display={kind}>
    <header className="column-header"><h2>{title} <span className="column-count">{tasks.length}</span></h2></header>
    <div className="column-body">{tasks.map(task => <article key={task.id} className="card" data-task-id={task.id}>
      <div className="card-header"><span>{task.id}</span><span className="badge">Paused</span></div>
      <h3 className="card-title">{task.title || task.description}</h3>
      <p>Original phase: {task.column}</p>
      <p>Reason: {task.terminalDisplay!.reason}</p>
      <p>Resume actor: {task.terminalDisplay!.resumeActor}</p>
      <button type="button" className="btn btn-secondary" onClick={() => onOpenDetail(task)}>Open {task.id}</button>
    </article>)}</div>
  </section>;
}
