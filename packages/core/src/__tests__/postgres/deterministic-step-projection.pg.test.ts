import { __setResetPublicationFailureForTesting } from "../../task-store/reset-lifecycle.js";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { pgDescribe, createSharedPgTaskStoreTestHarness } from "../../__test-utils__/pg-test-harness.js";
import type { WorkflowIr } from "../../types.js";
import { runConfiguredCommand } from "../../../../engine/src/executor/configured-command.js";
import { createDeterministicStepProjection } from "../../../../engine/src/executor/deterministic-step-projection.js";
import { WorkflowGraphExecutor } from "../../../../engine/src/workflows/workflow-graph-executor.js";

const ir: WorkflowIr = {
  version: "v2", name: "deterministic-step-projection", columns: [{ id: "work", name: "Work", traits: [] }],
  nodes: [{ id: "start", kind: "start" }, { id: "steps", kind: "foreach", config: { source: "task-steps", mode: "sequential", isolation: "shared", template: {
    nodes: [{ id: "check", kind: "script", config: { scriptName: "check", gateMode: "gate" } }], edges: [],
  } } }, { id: "end", kind: "end" }],
  edges: [{ from: "start", to: "steps" }, { from: "steps", to: "end", condition: "success" }],
};
pgDescribe("deterministic script task projection candidate", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_a2_red", projectId: "proj-a2-protected", poolMax: 4 });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterAll(h.afterAll);
  async function fixture() {
    const store = h.store();
    const task = await store.createTask({ description: "deterministic isolated fixture" });
    await store.updateTask(task.id, { steps: [{ name: "Original assertion", status: "pending" }], checkedOutBy: "agent-old", checkoutNodeId: "host-old", checkoutRunId: "run-old", checkoutLeaseEpoch: 1 });
    return store.getTask(task.id);
  }
  it("starts the native step before script execution and completes it after blocking success", async () => {
    const task = await fixture();
    const entryStatuses: string[] = [];
    const executor = new WorkflowGraphExecutor({
      signal: new AbortController().signal,
      createDeterministicStepProjection: (task, steps, signal) => createDeterministicStepProjection(h.store(), task, steps, signal),
      handlers: { script: async () => {
      entryStatuses.push((await h.store().getTask(task.id)).steps[0].status);
      const command = await runConfiguredCommand("printf 'A2_ASSERTIONS_PASS\\n'", process.cwd(), 1000);
      expect(command.exitCode).toBe(0);
      expect(command.stdout).toContain("A2_ASSERTIONS_PASS");
      return { outcome: "success", value: "passed", contextPatch: { scriptSucceeded: true, output: command.stdout } };
    } } });
    await executor.run(task, { experimentalFeatures: { workflowGraphExecutor: true } }, ir);
    expect.soft(entryStatuses).toEqual(["in-progress"]);
    expect((await h.store().getTask(task.id)).steps[0].status).toBe("done");
  });
  it("native start rejects a dependent script before a command can run", async () => {
    const task = await fixture();
    await h.store().updateTask(task.id, { steps: [...task.steps, { name: "Depends on first", status: "pending" }] });
    const verdict = await h.store().startStep(task.id, 1, { source: "graph" });
    expect(verdict.accepted).toBe(false);
    expect(verdict.disposition).toBe("blocked");
  });
  it.each(["failure", "skipped", "advisory-failed", "cancelled"] as const)("does not mark a script step done after %s", async (ending) => {
    const task = await fixture();
    const abort = new AbortController();
    const executor = new WorkflowGraphExecutor({ signal: abort.signal,
      createDeterministicStepProjection: (task, steps, signal) => createDeterministicStepProjection(h.store(), task, steps, signal), handlers: { script: async () => {
      if (ending === "cancelled") abort.abort();
      return { outcome: ending === "failure" ? "failure" : "success", value: ending === "advisory-failed" ? "failed" : undefined,
        contextPatch: { scriptSucceeded: ending !== "failure" && ending !== "advisory-failed", ...(ending === "skipped" ? { notRunReason: "execution-mode-skip" } : {}) } };
    } } });
    await executor.run(task, { experimentalFeatures: { workflowGraphExecutor: true } }, ir);
    expect((await h.store().getTask(task.id)).steps[0].status).not.toBe("done");
  });
  it.each(["reset-replan", "checkout-release", "same-lease-replaced", "same-lease-reordered", "dependsOn-empty"] as const)("refuses stale native completion after %s while command is in flight", async (supersession) => {
    const store = h.store();
    let task = await fixture();
    await store.updateTask(task.id, { steps: [...task.steps, { name: "Second assertion", status: "pending" }] });
    task = await store.getTask(task.id);
    const options = { source: "graph" as const,
      ownership: { runId: "run-old", agentId: "agent-old", nodeId: "host-old", leaseEpoch: 1 },
      expectedSteps: task.steps.map(({ status: _status, ...definition }) => definition), signal: new AbortController().signal };
    const start = await store.startStep(task.id, 0, options);
    expect(start.accepted).toBe(true);
    task = await store.getTask(task.id);
    let finishCommand!: () => void;
    const command = new Promise<void>((resolve) => { finishCommand = resolve; });
    // This is the proposed callback's existing native API, deliberately without a new production fence.
    const lateCompletion = command.then(() => store.updateStep(task.id, 0, "done", options));
    if (supersession === "reset-replan") {
      await store.resetTaskPublication(task.id, "todo");
      await store.updateTask(task.id, { steps: [{ name: "New owner's assertion", status: "pending" }], checkedOutBy: "agent-new", checkoutNodeId: "host-new", checkoutRunId: "run-new", checkoutLeaseEpoch: 2 });
    } else if (supersession === "checkout-release") {
      await store.updateTask(task.id, { checkedOutBy: null, checkoutNodeId: null, checkoutRunId: null, checkoutLeaseEpoch: 2 });
    } else if (supersession === "same-lease-replaced") {
      await store.updateTask(task.id, { steps: task.steps.map((step, i) => i === 0 ? { ...step, name: "Replacement" } : step) });
    } else if (supersession === "same-lease-reordered") {
      await store.updateTask(task.id, { steps: [...task.steps].reverse() });
    } else {
      await store.updateTask(task.id, { steps: task.steps.map((step, i) => i === 0 ? { ...step, dependsOn: [] } : step) });
    }
    const superseded = await store.getTask(task.id);
    if (supersession === "reset-replan") {
      expect(superseded).toMatchObject({ checkoutRunId: "run-new", checkoutLeaseEpoch: 2 });
      expect(superseded.steps[0]).toMatchObject({ name: "New owner's assertion", status: "pending" });
    } else if (supersession === "checkout-release") {
      expect(superseded.checkedOutBy).toBeFalsy();
      expect(superseded.checkoutRunId).toBeFalsy();
      expect(superseded.checkoutLeaseEpoch).toBe(2);
    }
    finishCommand();
    await expect(lateCompletion).rejects.toThrow();
    const current = await store.getTask(task.id);
    expect(current.steps[0].status).not.toBe("done");
    if (supersession === "reset-replan") expect(current.steps[0].name).toBe("New owner's assertion");
  });
  it.each(["reset", "release"] as const)("the actual graph refuses stale command completion after %s", async (change) => {
    const store = h.store();
    const task = await fixture();
    let entered!: () => void;
    const enteredCommand = new Promise<void>(resolve => { entered = resolve; });
    let finish!: () => void;
    const finishCommand = new Promise<void>(resolve => { finish = resolve; });
    let calls = 0;
    const executor = new WorkflowGraphExecutor({
      signal: new AbortController().signal, runId: "graph-protected",
      getTaskSteps: async () => (await store.getTask(task.id)).steps,
      createDeterministicStepProjection: (task, steps, signal) => createDeterministicStepProjection(store, task, steps, signal),
      stepInstancePersistence: { saveInstanceState: state => store.saveWorkflowRunStepInstanceAsync({ ...state, updatedAt: "ignored" }) },
      handlers: { script: async () => {
        calls++;
        expect((await store.getTask(task.id)).steps[0].status).toBe("in-progress");
        entered(); await finishCommand;
        return { outcome: "success", contextPatch: { scriptSucceeded: true } };
      } },
    });
    const run = executor.run(task, { experimentalFeatures: { workflowGraphExecutor: true } }, ir);
    await enteredCommand;
    try {
      if (change === "reset") {
        await store.resetTaskPublication(task.id, "todo");
        await store.updateTask(task.id, { steps: [{ name: "Replacement", status: "pending" }], checkedOutBy: "new", checkoutNodeId: "new", checkoutRunId: "new", checkoutLeaseEpoch: 2 });
      } else await store.updateTask(task.id, { checkedOutBy: null, checkoutNodeId: null, checkoutRunId: null, checkoutLeaseEpoch: 2 });
    } finally { finish(); }
    const result = await run;
    expect(result.outcome).toBe("failure");
    expect(calls).toBe(1);
    expect((await store.getTask(task.id)).steps[0].status).not.toBe("done");
    const instances = await store.loadWorkflowRunStepInstancesAsync(task.id, "graph-protected");
    expect(instances.some(instance => instance.status === "completed")).toBe(false);
  });
  it("preserves other native columns and skips completed work on graph replay", async () => {
    const store = h.store(); const task = await fixture(); let calls = 0;
    const executor = new WorkflowGraphExecutor({
      signal: new AbortController().signal, runId: "graph-protected",
      getTaskSteps: async () => (await store.getTask(task.id)).steps,
      createDeterministicStepProjection: (task, steps, signal) => createDeterministicStepProjection(store, task, steps, signal),
      stepInstancePersistence: { saveInstanceState: state => store.saveWorkflowRunStepInstanceAsync({ ...state, updatedAt: "ignored" }) },
      handlers: { script: async () => {
        calls++;
        await store.updateTask(task.id, { summary: "Concurrent owned metadata", tokenBudgetOverride: { hard: 99 } });
        expect((await store.getTask(task.id)).tokenBudgetOverride).toEqual({ hard: 99 });
        return { outcome: "success", contextPatch: { scriptSucceeded: true } };
      } },
    });
    await executor.run(task, { experimentalFeatures: { workflowGraphExecutor: true } }, ir);
    const done = await store.getTask(task.id);
    expect(done).toMatchObject({ summary: "Concurrent owned metadata", tokenBudgetOverride: { hard: 99 }, checkoutRunId: "run-old" });
    expect(done.steps[0].status).toBe("done");
    expect((await store.loadWorkflowRunStepInstancesAsync(task.id, "graph-protected"))[0].status).toBe("completed");
    await executor.run(done, { experimentalFeatures: { workflowGraphExecutor: true } }, ir);
    expect(calls).toBe(1);
  });
  it.each(["pause", "abort", "partial", "not-started"] as const)("protected mutation refuses %s", async mode => {
    const store = h.store(); const task = await fixture(); const abort = new AbortController();
    const options = { source: "graph" as const, ownership: { runId: "run-old", agentId: "agent-old", nodeId: "host-old", leaseEpoch: 1 }, expectedSteps: task.steps.map(({ status: _status, ...definition }) => definition), signal: abort.signal };
    if (mode === "pause") await store.updateTask(task.id, { paused: true });
    if (mode === "abort") abort.abort();
    if (mode === "partial") options.ownership.nodeId = "";
    const mutation = mode === "not-started" ? store.updateStep(task.id, 0, "done", options) : store.startStep(task.id, 0, options);
    await expect(mutation).rejects.toThrow();
    expect((await store.getTask(task.id)).steps[0].status).toBe("pending");
  });

  it("aborts a protected start waiting behind Reset without publishing a step", async () => {
    const store = h.store(); const task = await fixture(); const abort = new AbortController();
    const options = { source: "graph" as const, ownership: { runId: "run-old", agentId: "agent-old", nodeId: "host-old", leaseEpoch: 1 }, expectedSteps: task.steps.map(({ status: _status, ...definition }) => definition), signal: abort.signal };
    let acquired!: () => void; const locked = new Promise<void>(resolve => { acquired = resolve; });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const restore = __setResetPublicationFailureForTesting(async () => { acquired(); await gate; });
    try {
      const reset = store.resetTaskPublication(task.id, "todo"); await locked;
      const start = store.startStep(task.id, 0, options);
      const refused = expect(start).rejects.toThrow("aborted");
      abort.abort(); release(); await reset; await refused;
      expect((await store.getTask(task.id)).steps).toEqual([]);
    } finally { release(); restore(); }
  });
  it("captures the caller's ordered plan before waiting on its native task lock", async () => {
    const store = h.store(); const task = await fixture();
    const options = { source: "graph" as const, ownership: { runId: "run-old", agentId: "agent-old", nodeId: "host-old", leaseEpoch: 1 }, expectedSteps: task.steps.map(({ status: _status, ...definition }) => definition), signal: new AbortController().signal };
    let acquired!: () => void; const locked = new Promise<void>(resolve => { acquired = resolve; });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const holder = store.withTaskLock(task.id, async () => { acquired(); await gate; });
    await locked;
    const start = store.startStep(task.id, 0, options);
    options.expectedSteps[0].name = "Caller mutation after admission";
    options.ownership.runId = "changed";
    release(); await holder;
    expect((await start).accepted).toBe(true);
    expect((await store.getTask(task.id)).steps[0].name).toBe("Original assertion");
  });

});
