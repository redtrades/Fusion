// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKFLOW_EXTENSION_SCHEMA_VERSION,
  __resetWorkflowExtensionRegistryForTests,
  getWorkflowExtensionRegistry,
  workflowExtensionRegistryId,
  type TaskDetail,
  type WorkflowNodeHandlerInput,
  type WorkflowNodeExtensionResult,
  type WorkflowIr,
} from "@fusion/core";
import { WorkflowGraphExecutor } from "../workflows/workflow-graph-executor.js";
import { WorkspacePreparationError } from "../worktree/worktree-acquisition.js";

const settingsOn = { experimentalFeatures: { workflowGraphExecutor: true } };

describe("workflow node-handler extensions", () => {
  afterEach(() => {
    __resetWorkflowExtensionRegistryForTests();
  });

  it("executes an extension-marked node and routes custom outcomes", async () => {
    const extensionKey = workflowExtensionRegistryId("node-plugin", "decision");
    const handle = vi.fn().mockResolvedValue({
      outcome: "outcome:needs-human",
      contextPatch: { decidedBy: "plugin" },
    });
    getWorkflowExtensionRegistry().register("node-plugin", {
      extensionId: "decision",
      name: "Decision",
      kind: "node-handler",
      nodeKind: "prompt",
      schemaVersion: WORKFLOW_EXTENSION_SCHEMA_VERSION,
      fallback: "failClosed",
      handle,
    });
    const workflow: WorkflowIr = {
      version: "v2",
      name: "node-extension",
      columns: [{ id: "work", name: "Work", traits: [] }],
      nodes: [
        { id: "start", kind: "start" },
        { id: "decide", kind: "prompt", column: "work", extensions: { [extensionKey]: {} } },
        { id: "human", kind: "prompt", column: "work", config: { prompt: "human" } },
        { id: "default", kind: "end" },
        { id: "end", kind: "end" },
      ],
      edges: [
        { from: "start", to: "decide" },
        { from: "decide", to: "human", condition: "outcome:needs-human" },
        { from: "decide", to: "default", condition: "success" },
        { from: "human", to: "end" },
      ],
    };
    const prompt = vi.fn(async () => ({ outcome: "success" as const }));
    const executor = new WorkflowGraphExecutor({ handlers: { prompt } });

    const result = await executor.run({ id: "FN-NODE" } as TaskDetail, settingsOn, workflow);

    expect(result.outcome).toBe("success");
    expect(result.visitedNodeIds).toEqual(["start", "decide", "human"]);
    expect(result.context).toMatchObject({ decidedBy: "plugin" });
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({
      node: expect.objectContaining({ id: "decide" }),
      workflow,
    }));
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ id: "human" }), expect.any(Object));
  });

  it("preserves plugin-provided values for custom outcomes", async () => {
    const extensionKey = workflowExtensionRegistryId("node-plugin", "decision");
    getWorkflowExtensionRegistry().register("node-plugin", {
      extensionId: "decision",
      name: "Decision",
      kind: "node-handler",
      nodeKind: "prompt",
      schemaVersion: WORKFLOW_EXTENSION_SCHEMA_VERSION,
      fallback: "failClosed",
      handle: vi.fn().mockResolvedValue({
        outcome: "outcome:ignored-route",
        value: "needs-human",
      }),
    });
    const workflow: WorkflowIr = {
      version: "v2",
      name: "node-extension",
      columns: [{ id: "work", name: "Work", traits: [] }],
      nodes: [
        { id: "start", kind: "start" },
        { id: "decide", kind: "prompt", column: "work", extensions: { [extensionKey]: {} } },
        { id: "human", kind: "prompt", column: "work", config: { prompt: "human" } },
        { id: "default", kind: "end" },
      ],
      edges: [
        { from: "start", to: "decide" },
        { from: "decide", to: "human", condition: "outcome:needs-human" },
        { from: "decide", to: "default", condition: "outcome:ignored-route" },
      ],
    };
    const prompt = vi.fn(async () => ({ outcome: "success" as const }));
    const executor = new WorkflowGraphExecutor({ handlers: { prompt } });

    const result = await executor.run({ id: "FN-NODE" } as TaskDetail, settingsOn, workflow);

    expect(result.outcome).toBe("success");
    expect(result.visitedNodeIds).toEqual(["start", "decide", "human"]);
  });

  it("degrades faulty node handlers before falling through to default handler", async () => {
    const extensionKey = workflowExtensionRegistryId("node-plugin", "decision");
    getWorkflowExtensionRegistry().register("node-plugin", {
      extensionId: "decision",
      name: "Decision",
      kind: "node-handler",
      nodeKind: "prompt",
      schemaVersion: WORKFLOW_EXTENSION_SCHEMA_VERSION,
      fallback: "degradeToDefault",
      handle: vi.fn().mockRejectedValue(new Error("handler failed")),
    });
    const workflow: WorkflowIr = {
      version: "v2",
      name: "node-extension",
      columns: [{ id: "work", name: "Work", traits: [] }],
      nodes: [
        { id: "start", kind: "start" },
        { id: "decide", kind: "prompt", column: "work", extensions: { [extensionKey]: {} } },
        { id: "end", kind: "end" },
      ],
      edges: [
        { from: "start", to: "decide" },
        { from: "decide", to: "end" },
      ],
    };
    const prompt = vi.fn(async () => ({ outcome: "success" as const }));
    const executor = new WorkflowGraphExecutor({ handlers: { prompt } });

    const result = await executor.run({ id: "FN-NODE" } as TaskDetail, settingsOn, workflow);

    expect(result.outcome).toBe("success");
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ id: "decide" }), expect.any(Object));
    expect(getWorkflowExtensionRegistry().get(extensionKey)?.degraded).toMatchObject({
      reason: "runtime-fault",
      message: "handler failed",
    });
  });

  function delegatedWorkflow(handle: (input: WorkflowNodeHandlerInput) => Promise<WorkflowNodeExtensionResult>, fallback: "failClosed" | "degradeToDefault" = "failClosed"): WorkflowIr {
    const key = workflowExtensionRegistryId("delegation", "current");
    getWorkflowExtensionRegistry().register("delegation", {
      extensionId: "current", name: "Current node", kind: "node-handler",
      schemaVersion: WORKFLOW_EXTENSION_SCHEMA_VERSION, fallback, handle,
    });
    return {
      version: "v2", name: "delegation", columns: [{ id: "work", name: "Work", traits: [] }],
      nodes: [{ id: "start", kind: "start" },
        { id: "worker", kind: "prompt", column: "work", config: { prompt: "bounded input" }, extensions: { [key]: {} } },
        { id: "end", kind: "end" }],
      edges: [{ from: "start", to: "worker" }, { from: "worker", to: "end" }],
    };
  }

  it("delegates the current admitted node once without re-entering the extension", async () => {
    let nativeRuns = 0, pluginRuns = 0;
    const events: string[] = [];
    const task = { id: "FN-DELEGATE", worktree: "/approved/worktree" } as TaskDetail;
    const workflow = delegatedWorkflow(async input => {
      pluginRuns++;
      expect(input.runDefault).toBeTypeOf("function");
      const first = input.runDefault!();
      expect(input.runDefault!()).toBe(first);
      const result = await first;
      expect(result.value).toBe("native-done");
      return result;
    });
    const executor = new WorkflowGraphExecutor({
      beforeNodeExecution: async node => { if (node.id === "worker") events.push("admitted"); },
      handlers: { prompt: async (node, ctx) => {
        nativeRuns++;
        events.push("native");
        expect(node.id).toBe("worker");
        expect(node.config?.prompt).toBe("bounded input");
        expect(ctx.task).toBe(task);
        expect(ctx.settings).toBe(settingsOn);
        return { outcome: "success", value: "native-done", contextPatch: { nativeReceipt: task.id } };
      } },
    });
    const result = await executor.run(task, settingsOn, workflow);
    expect(result.outcome).toBe("success");
    expect(result.context.nativeReceipt).toBe("FN-DELEGATE");
    expect({ nativeRuns, pluginRuns }).toEqual({ nativeRuns: 1, pluginRuns: 1 });
    expect(events).toEqual(["admitted", "native"]);
  });

  it("refuses native delegation when the graph is cancelled inside the plugin", async () => {
    const abort = new AbortController();
    let nativeRuns = 0;
    const workflow = delegatedWorkflow(async ({ runDefault }) => {
      abort.abort();
      return runDefault!();
    });
    const executor = new WorkflowGraphExecutor({ signal: abort.signal,
      handlers: { prompt: async () => { nativeRuns++; return { outcome: "success" }; } },
    });
    const result = await executor.run({ id: "FN-ABORT" } as TaskDetail, settingsOn, workflow);
    expect(result.outcome).toBe("failure");
    expect(nativeRuns).toBe(0);
  });

  it("does not repeat native work when a delegating plugin fails with fallback enabled", async () => {
    let nativeRuns = 0;
    const workflow = delegatedWorkflow(async ({ runDefault }) => {
      await runDefault!();
      throw new Error("post-dispatch validation failed");
    }, "degradeToDefault");
    const executor = new WorkflowGraphExecutor({ maxRetriesPerNode: 3,
      handlers: { prompt: async () => { nativeRuns++; return { outcome: "success" }; } },
    });
    const result = await executor.run({ id: "FN-POST-FAIL" } as TaskDetail, settingsOn, workflow);
    expect(result.outcome).toBe("failure");
    expect(nativeRuns).toBe(1);
  });

  it("memoizes a rejected native call so a plugin cannot dispatch it again", async () => {
    let nativeRuns = 0;
    const workflow = delegatedWorkflow(async ({ runDefault }) => {
      const first = runDefault!();
      await expect(first).rejects.toThrow("native failure");
      expect(runDefault!()).toBe(first);
      await expect(runDefault!()).rejects.toThrow("native failure");
      return { outcome: "failure", value: "native-failed" };
    });
    const executor = new WorkflowGraphExecutor({
      handlers: { prompt: async () => { nativeRuns++; throw new Error("native failure"); } },
    });
    const result = await executor.run({ id: "FN-NATIVE-FAIL" } as TaskDetail, settingsOn, workflow);
    expect(result.outcome).toBe("failure");
    expect(nativeRuns).toBe(1);
  });

  it("keeps graph admission until an unawaited native call finishes", async () => {
    const events: string[] = [];
    let finish!: () => void;
    let started!: () => void;
    const nativeStarted = new Promise<void>(resolve => { started = resolve; });
    const nativeFinished = new Promise<void>(resolve => { finish = resolve; });
    const workflow = delegatedWorkflow(async ({ runDefault }) => {
      void runDefault!();
      return { outcome: "success", value: "plugin-finished" };
    });
    const executor = new WorkflowGraphExecutor({ handlers: { prompt: async () => {
      events.push("native-start"); started(); await nativeFinished;
      events.push("native-end"); return { outcome: "success" };
    } } });
    const run = executor.run({ id: "FN-WAIT" } as TaskDetail, settingsOn, workflow).then(result => {
      events.push("graph-end"); return result;
    });
    await nativeStarted;
    await Promise.resolve();
    expect(events).toEqual(["native-start"]);
    finish(); await run;
    expect(events).toEqual(["native-start", "native-end", "graph-end"]);
  });

  it.each(["node", "task", "context"] as const)("rejects plugin mutation of admitted %s before native dispatch", async target => {
    let nativeRuns = 0, attempted = false;
    const workflow = delegatedWorkflow(async input => {
      attempted = true;
      if (target === "node") input.node.config!.prompt = "replacement command";
      if (target === "task") input.task.id = "foreign-task";
      if (target === "context") input.context["foreign-principal"] = "replacement";
      return input.runDefault!();
    });
    const executor = new WorkflowGraphExecutor({ handlers: { prompt: async () => {
      nativeRuns++; return { outcome: "success" };
    } } });
    const result = await executor.run({ id: "FN-BOUND" } as TaskDetail, settingsOn, workflow);
    expect(attempted).toBe(true);
    expect(nativeRuns).toBe(0);
    expect(result.outcome).toBe("failure");
  });

  it("forwards cancellation during native execution and waits for native cleanup", async () => {
    const abort = new AbortController();
    const events: string[] = [];
    const workflow = delegatedWorkflow(async ({ runDefault }) => {
      const pending = runDefault!();
      await Promise.resolve();
      abort.abort();
      return pending;
    });
    const executor = new WorkflowGraphExecutor({ signal: abort.signal, handlers: { prompt: async (_node, ctx) => {
      expect(ctx.signal).toBe(abort.signal);
      events.push("native-start");
      await new Promise<void>(resolve => ctx.signal!.addEventListener("abort", () => resolve(), { once: true }));
      events.push("native-cleanup"); return { outcome: "failure", value: "aborted" };
    } } });
    const result = await executor.run({ id: "FN-MID-ABORT" } as TaskDetail, settingsOn, workflow);
    expect(result.outcome).toBe("failure");
    expect(events).toEqual(["native-start", "native-cleanup"]);
  });

  it.each([true, false])("preserves native preparation refusal when plugin awaits delegation: %s", async awaits => {
    const refusal = new WorkspacePreparationError("approved/repo", "acquire", "fixture refusal");
    const workflow = delegatedWorkflow(async ({ runDefault }) => {
      const pending = runDefault!();
      if (awaits) return pending;
      return { outcome: "success" };
    });
    const executor = new WorkflowGraphExecutor({ handlers: { prompt: async () => { throw refusal; } } });
    const result = await executor.run({ id: "FN-PREPARE" } as TaskDetail, settingsOn, workflow);
    expect(result.context["node:worker:value"]).toBe("workspace-preparation-failure-hold");
  });

  it("refuses a retained callback after its plugin invocation finishes", async () => {
    let retained: WorkflowNodeHandlerInput["runDefault"];
    let nativeRuns = 0;
    const workflow = delegatedWorkflow(async ({ runDefault }) => {
      retained = runDefault;
      return { outcome: "success" };
    });
    const executor = new WorkflowGraphExecutor({ handlers: { prompt: async () => {
      nativeRuns++; return { outcome: "success" };
    } } });
    await executor.run({ id: "FN-LATE" } as TaskDetail, settingsOn, workflow);
    await expect(retained!()).rejects.toThrow("no longer active");
    expect(nativeRuns).toBe(0);
  });

  it("does not cache native delegation across separate admitted runs", async () => {
    let nativeRuns = 0;
    const workflow = delegatedWorkflow(async ({ runDefault }) => runDefault!());
    const executor = new WorkflowGraphExecutor({ handlers: { prompt: async () => {
      nativeRuns++; return { outcome: "success", contextPatch: { nativeRuns } };
    } } });
    await executor.run({ id: "FN-FIRST" } as TaskDetail, settingsOn, workflow);
    const result = await executor.run({ id: "FN-SECOND" } as TaskDetail, settingsOn, workflow);
    expect(result.context.nativeRuns).toBe(2);
  });

});
