import { describe, expect, it, vi } from "vitest";
import type { Task, TaskDetail, TaskStore, WorkflowIr, WorkflowStep, WorkflowStepResult } from "@fusion/core";
import { executeScriptWorkflowStep, type ScriptWorkflowStepDeps } from "../executor/workflow-script-step.js";
import { runGraphCustomNode, type RunGraphCustomNodeDeps } from "../executor/run-graph-custom-node.js";
import { runConfiguredCommand } from "../executor/configured-command.js";
import { WorkflowGraphExecutor } from "../workflows/workflow-graph-executor.js";

const task = { id: "FN-script-evidence", steps: [{ name: "One", status: "pending" }, { name: "Two", status: "pending" }] } as TaskDetail;
const step = { name: "Assertions", scriptName: "assertions" } as WorkflowStep;
function scriptDeps(): ScriptWorkflowStepDeps {
  return {
    store: { logEntry: vi.fn(async () => {}) } as unknown as TaskStore,
    getRunContextFor: () => undefined,
    registerConfiguredCommandController: vi.fn(),
    unregisterConfiguredCommandController: vi.fn(),
    runConfiguredCommand,
  };
}
function graph(foreach = false): WorkflowIr {
  const script = { id: "assertions", kind: "script" as const, config: { scriptName: "assertions", gateMode: "gate" } };
  return {
    version: "v2", name: "script-evidence", columns: [{ id: "work", name: "Work", traits: [] }],
    nodes: [{ id: "start", kind: "start" }, foreach ? { id: "steps", kind: "foreach", config: { source: "task-steps", template: { nodes: [script], edges: [] } } } : script, { id: "end", kind: "end" }],
    edges: [{ from: "start", to: foreach ? "steps" : "assertions" }, { from: foreach ? "steps" : "assertions", to: "end", condition: "success" }],
  };
}

describe("named script evidence", () => {
  it("retains actual harmless command stdout and stderr with exit evidence", async () => {
    const result = await executeScriptWorkflowStep(scriptDeps(), task as Task, step, process.cwd(), {
      scripts: { assertions: "printf 'ASSERTIONS_PASS\\n'; printf 'diagnostic\\n' >&2" },
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("ASSERTIONS_PASS");
    expect(result.output).toContain("diagnostic");
    expect(result.output).toContain("Exit code: 0");
  });
  it("bounds each successful output stream", async () => {
    const deps = scriptDeps();
    deps.runConfiguredCommand = vi.fn(async () => ({ stdout: "x".repeat(12000) + "TAIL", stderr: "y".repeat(12000) + "ERRTAIL", exitCode: 0, signal: null, timedOut: false }));
    const result = await executeScriptWorkflowStep(deps, task, step, process.cwd(), { scripts: { assertions: "unused" } });
    expect(result.output).toContain("TAIL");
    expect(result.output).toContain("ERRTAIL");
    expect(result.output!.length).toBeLessThan(8500);
  });
  it.each([false, true])("records ordinary scripts with concrete identities (foreach=%s)", async (foreach) => {
    const records: WorkflowStepResult[] = [];
    const logs: string[] = [];
    const executor = new WorkflowGraphExecutor({
      handlers: { script: async () => ({ outcome: "success", value: "passed", contextPatch: { output: "ASSERTIONS_PASS" } }) },
      recordWorkflowStepResult: async (_id, result) => { records.push(result); return { scopeCurrent: true, persisted: true }; },
      logTaskEntry: (summary, detail) => { logs.push(`${summary}\n${detail ?? ""}`); },
    });
    await executor.run(task, { experimentalFeatures: { workflowGraphExecutor: true } }, graph(foreach));
    const finished = records.filter((record) => record.status === "passed");
    expect(finished.map((record) => record.workflowStepId)).toEqual(foreach ? ["steps#0:assertions", "steps#1:assertions"] : ["assertions"]);
    expect(finished.every((record) => record.source === "node" && record.output === "ASSERTIONS_PASS" && record.reviewKind === undefined)).toBe(true);
    expect(logs.filter((line) => line.includes("ASSERTIONS_PASS"))).toHaveLength(foreach ? 2 : 1);
    expect(task.steps.every((item) => item.status === "pending")).toBe(true);
  });
});


describe("script evidence failure and ownership boundaries", () => {
  it("projects actual failing command diagnostics through the native custom-node adapter", async () => {
    const live = { ...task, worktree: process.cwd() };
    const commandDeps = scriptDeps();
    const deps = {
      store: { ...commandDeps.store, getTask: async () => live }, rootDir: process.cwd(), options: {},
      graphUnattendedRuns: new Set(), getRunContextFor: () => undefined,
      resolveWorkflowInputMarkerForGraphNode: async () => undefined,
      executeScriptWorkflowStep: (t: Task, st: WorkflowStep, cwd: string, settings: Parameters<typeof executeScriptWorkflowStep>[4]) => executeScriptWorkflowStep(commandDeps, t, st, cwd, settings),
    } as unknown as RunGraphCustomNodeDeps;
    const result = await runGraphCustomNode(deps, { id: "assertions", kind: "script", config: { scriptName: "assertions", gateMode: "gate" } }, live, {
      scripts: { assertions: "printf 'ASSERTION_FAILED\\n' >&2; exit 7" },
    });
    expect(result.outcome).toBe("failure");
    expect(result.contextPatch?.output).toContain("ASSERTION_FAILED");
    expect(result.contextPatch?.output).toContain("Exit code: 7");
    expect(result.contextPatch?.findings).toBeUndefined();
  });
  it("records an advisory script's actual failure without changing its successful route", async () => {
    const records: WorkflowStepResult[] = [];
    const live = { ...task, worktree: process.cwd() };
    const deps = {
      store: { getTask: async () => live }, rootDir: process.cwd(), options: {}, graphUnattendedRuns: new Set(),
      getRunContextFor: () => undefined, resolveWorkflowInputMarkerForGraphNode: async () => undefined,
      executeScriptWorkflowStep: async () => ({ success: false, error: "actual exit failure" }),
    } as unknown as RunGraphCustomNodeDeps;
    const ir = graph();
    ir.nodes[1].config!.gateMode = "advisory";
    const executor = new WorkflowGraphExecutor({
      handlers: { script: (node) => runGraphCustomNode(deps, node, live, {}) },
      recordWorkflowStepResult: async (_id, result) => { records.push(result); return { scopeCurrent: true, persisted: true }; },
    });
    const result = await executor.run(live, { experimentalFeatures: { workflowGraphExecutor: true } }, ir);
    expect(result.outcome).toBe("success");
    expect(records.at(-1)).toMatchObject({ status: "failed", output: "actual exit failure" });
  });
  it("a throwing best-effort log sink cannot cause another script dispatch", async () => {
    const handler = vi.fn(async () => ({ outcome: "success" as const, contextPatch: { output: "actual output" } }));
    const executor = new WorkflowGraphExecutor({
      handlers: { script: handler },
      recordWorkflowStepResult: async () => ({ scopeCurrent: true, persisted: true }),
      logTaskEntry: () => { throw new Error("log unavailable"); },
    });
    const result = await executor.run(task, { experimentalFeatures: { workflowGraphExecutor: true } }, graph());
    expect(handler).toHaveBeenCalledOnce();
    expect(result.outcome).toBe("success");
  });
  it("missing scripts do not run a command", async () => {
    const deps = scriptDeps();
    deps.runConfiguredCommand = vi.fn();
    const result = await executeScriptWorkflowStep(deps, task, step, process.cwd(), {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
    expect(deps.runConfiguredCommand).not.toHaveBeenCalled();
  });
  it("native script cancellation cannot become a successful receipt", async () => {
    const deps = scriptDeps();
    deps.registerConfiguredCommandController = (_id, controller) => controller.abort();
    deps.runConfiguredCommand = vi.fn(async () => ({ stdout: "late output", stderr: "", exitCode: 0, signal: null, timedOut: false }));
    await expect(executeScriptWorkflowStep(deps, task, step, process.cwd(), { scripts: { assertions: "unused" } })).rejects.toMatchObject({ name: "AbortError" });
    expect(deps.unregisterConfiguredCommandController).toHaveBeenCalledOnce();
  });
  it.each(["failure", "cancel", "unpersisted"] as const)("does not claim completion when %s", async (mode) => {
    const records: WorkflowStepResult[] = [];
    const logs = vi.fn();
    const discard = vi.fn();
    const controller = new AbortController();
    const executor = new WorkflowGraphExecutor({
      signal: controller.signal,
      handlers: { script: async () => {
        if (mode === "cancel") controller.abort();
        return { outcome: mode === "failure" ? "failure" : "success", contextPatch: { output: "actual diagnostic" } };
      } },
      recordWorkflowStepResult: async (_id, result) => { records.push(result); return { scopeCurrent: true, persisted: mode !== "unpersisted" }; },
      discardWorkflowStepLease: discard,
      logTaskEntry: logs,
    });
    await executor.run(task, { experimentalFeatures: { workflowGraphExecutor: true } }, graph(true));
    if (mode === "cancel") {
      expect(records.some((record) => record.status === "passed")).toBe(false);
      expect(discard).toHaveBeenCalledWith(task.id, "steps#0:assertions", expect.any(String));
    } else if (mode === "failure") {
      expect(records.some((record) => record.status === "failed" && record.output === "actual diagnostic")).toBe(true);
      expect(logs).toHaveBeenCalledWith(expect.stringContaining("failed: steps#0:assertions"), "actual diagnostic");
    } else expect(logs).not.toHaveBeenCalled();
  });
  it("skipped scripts remain skipped and never claim completed assertions", async () => {
    const records: WorkflowStepResult[] = [];
    const log = vi.fn();
    const executor = new WorkflowGraphExecutor({
      handlers: { script: async () => ({ outcome: "success", contextPatch: { notRunReason: "execution-mode-skip", output: "NOTHING WAS VERIFIED" } }) },
      recordWorkflowStepResult: async (_id, result) => { records.push(result); return { scopeCurrent: true, persisted: true }; },
      logTaskEntry: log,
    });
    await executor.run(task, { experimentalFeatures: { workflowGraphExecutor: true } }, graph(true));
    expect(records.filter((record) => record.status === "skipped")).toHaveLength(2);
    expect(records.some((record) => record.status === "passed")).toBe(false);
    expect(log.mock.calls.every(([summary]) => summary.includes("not executed"))).toBe(true);
  });
  it("optional-group script children do not create duplicate node records", async () => {
    const ir = graph();
    const script = ir.nodes[1];
    ir.nodes[1] = { id: "group", kind: "optional-group", config: { defaultOn: true, template: { nodes: [script], edges: [] } } };
    ir.edges = [{ from: "start", to: "group" }, { from: "group", to: "end", condition: "success" }];
    const records: WorkflowStepResult[] = [];
    const executor = new WorkflowGraphExecutor({
      handlers: { script: async () => ({ outcome: "success", contextPatch: { output: "real output" } }) },
      recordWorkflowStepResult: async (_id, result) => { records.push(result); return { scopeCurrent: true, persisted: true }; },
    });
    await executor.run({ ...task, enabledWorkflowSteps: ["group"] }, { experimentalFeatures: { workflowGraphExecutor: true } }, ir);
    expect(records.some((record) => record.source === "node")).toBe(false);
    expect(records.some((record) => record.workflowStepId === "group" && record.status === "passed")).toBe(true);
  });
});
