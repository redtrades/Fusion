import { describe, expect, it, vi } from "vitest";
import { parseWorkflowIr } from "@fusion/core";
import { runForeach } from "../workflows/workflow-graph-foreach.js";
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


describe("conditional deterministic template completion", () => {
  function diamond(): WorkflowIrNode {
    const templateNodes = ["select", "left", "right", "finish"].map(id => ({
      id, kind: "script" as const, config: { scriptName: id, gateMode: "gate" },
    }));
    const fe: WorkflowIrNode = { id: "fe", kind: "foreach", config: {
      source: "task-steps", mode: "sequential", isolation: "shared", template: {
        nodes: templateNodes, edges: [
          { from: "select", to: "left", condition: "outcome:passed" },
          { from: "select", to: "right", condition: "outcome:failed" },
          { from: "left", to: "finish", condition: "success" },
          { from: "right", to: "finish", condition: "success" },
        ],
      },
    } };
    const ir = parseWorkflowIr({ version: "v2", name: "branch", columns: [{ id: "work", name: "Work", traits: [] }],
      nodes: [{ id: "start", kind: "start" }, { id: "parse", kind: "parse-steps", config: { artifact: "PROMPT.md", parser: "markdown" } }, fe, { id: "end", kind: "end" }],
      edges: [{ from: "start", to: "parse" }, { from: "parse", to: "fe" }, { from: "fe", to: "end", condition: "success" }],
    });
    return ir.nodes.find(node => node.id === "fe")!;
  }
  it.each(["success", "failure", "unverified", "skipped", "cancelled"] as const)("honors selected branch %s without requiring the unselected sibling", async mode => {
    const order: string[] = [];
    const signal = new AbortController();
    const complete = vi.fn(async () => { order.push("done"); return true; });
    const result = await runForeach(diamond(), {
      task, runId: "branch-run", steps: task.steps!, context: {}, signal: signal.signal,
      createDeterministicStepProjection: () => ({ start: async () => { order.push("start"); return true; }, complete }),
      runTemplateNode: async node => {
        order.push(node.id);
        if (node.id === "left") {
          if (mode === "cancelled") signal.abort();
          if (mode === "failure") return { outcome: "failure", value: "failed", contextPatch: { scriptSucceeded: false } };
          if (mode === "unverified") return { outcome: "success", value: "passed", contextPatch: { scriptSucceeded: false } };
          if (mode === "skipped") return { outcome: "success", value: "passed", contextPatch: { scriptSucceeded: true, notRunReason: "fixture-skip" } };
        }
        return { outcome: "success", value: "passed", contextPatch: { scriptSucceeded: true } };
      },
      shouldTraverseEdge: (edge, source) => edge.condition?.startsWith("outcome:")
        ? source.value === edge.condition.slice("outcome:".length)
        : source.outcome === "success",
      persistence: { saveInstanceState: state => { if (state.status === "completed") order.push("completed"); } },
    });
    if (mode === "success") {
      expect(result.outcome).toBe("success");
      expect(order).toEqual(["start", "select", "left", "finish", "done", "completed"]);
      expect(complete).toHaveBeenCalledExactlyOnceWith(0);
    } else {
      expect(result.outcome).toBe("failure");
      expect(order).toEqual(["start", "select", "left"]);
      expect(complete).not.toHaveBeenCalled();
    }
  });
});
