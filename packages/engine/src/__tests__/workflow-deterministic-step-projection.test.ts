import { describe, expect, it, vi } from "vitest";
import type { TaskDetail, WorkflowIr, WorkflowIrNode } from "@fusion/core";
import { WorkflowGraphExecutor } from "../workflows/workflow-graph-executor.js";
const task = { id: "FN-det", steps: [{ name: "One", status: "pending" }] } as TaskDetail;
const script: WorkflowIrNode = { id: "check", kind: "script", config: { scriptName: "check", gateMode: "gate" } };
function graph(nodes = [script], config: Record<string, unknown> = {}): WorkflowIr {
  return { version: "v2", name: "det", columns: [{ id: "work", name: "Work", traits: [] }],
    nodes: [{ id: "start", kind: "start" }, { id: "fe", kind: "foreach", config: { source: "task-steps", mode: "sequential", isolation: "shared", ...config, template: { nodes, edges: nodes.slice(1).map((node, i) => ({ from: nodes[i].id, to: node.id, condition: "success" })) } } }, { id: "end", kind: "end" }],
    edges: [{ from: "start", to: "fe" }, { from: "fe", to: "end", condition: "success" }] };
}
describe("deterministic foreach projection authority", () => {
  it.each(["advisory", "review", "worktree", "parallel", "script-seam", "cli-agent", "workflow-action"] as const)("does not acquire deterministic completion authority for %s", async mode => {
    const factory = vi.fn();
    const nodes = mode === "advisory" ? [{ ...script, config: { ...script.config, gateMode: "advisory" } }]
      : mode === "review" ? [{ id: "execute", kind: "prompt" as const, config: { seam: "step-execute" } }, { id: "review", kind: "step-review" as const }]
      : mode === "script-seam" ? [{ ...script, config: { ...script.config, seam: "step-execute" } }]
      : mode === "cli-agent" ? [{ ...script, config: { ...script.config, executor: "cli-agent" } }]
      : mode === "workflow-action" ? [{ ...script, config: { ...script.config, workflowAction: "deterministic-verification" } }]
      : [script];
    const executor = new WorkflowGraphExecutor({ signal: new AbortController().signal, createDeterministicStepProjection: factory,
      handlers: { script: async () => ({ outcome: "success" }), prompt: async () => ({ outcome: "success" }), "step-review": async () => ({ outcome: "success" }) } });
    await executor.run(task, {}, graph(nodes, mode === "worktree" ? { isolation: "worktree" } : mode === "parallel" ? { mode: "parallel" } : {}));
    expect(factory).not.toHaveBeenCalled();
  });
  it("orders accepted native start, scripts, accepted done, then instance completion", async () => {
    const order: string[] = [];
    const executor = new WorkflowGraphExecutor({ signal: new AbortController().signal,
      createDeterministicStepProjection: () => ({ start: async () => { order.push("start"); return true; }, complete: async () => { order.push("done"); return true; } }),
      handlers: { script: async () => { order.push("script"); return { outcome: "success", contextPatch: { scriptSucceeded: true } }; } },
      stepInstancePersistence: { saveInstanceState: state => { if (state.status === "completed") order.push("completed"); } } });
    await executor.run(task, {}, graph());
    expect(order).toEqual(["start", "script", "done", "completed"]);
  });
  it.each(["start", "done"] as const)("refuses instance completion if native %s is rejected", async refused => {
    const command = vi.fn(async () => ({ outcome: "success" as const, contextPatch: { scriptSucceeded: true } }));
    const states: string[] = [];
    const executor = new WorkflowGraphExecutor({ signal: new AbortController().signal,
      createDeterministicStepProjection: () => ({ start: async () => refused !== "start", complete: async () => false }),
      handlers: { script: command }, stepInstancePersistence: { saveInstanceState: state => { states.push(state.status); } } });
    const result = await executor.run(task, {}, graph());
    expect(result.outcome).toBe("failure");
    expect(states).not.toContain("completed");
    expect(command).toHaveBeenCalledTimes(refused === "start" ? 0 : 1);
  });
});
