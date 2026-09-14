import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { pgDescribe, createSharedPgTaskStoreTestHarness } from "../../__test-utils__/pg-test-harness.js";
import type { WorkflowIr } from "../../types.js";
import { runConfiguredCommand } from "../../../../engine/src/executor/configured-command.js";
import { WorkflowGraphExecutor } from "../../../../engine/src/workflows/workflow-graph-executor.js";

const ir: WorkflowIr = {
  version: "v2", name: "deterministic-step-projection", columns: [{ id: "work", name: "Work", traits: [] }],
  nodes: [{ id: "start", kind: "start" }, { id: "steps", kind: "foreach", config: { source: "task-steps", mode: "sequential", isolation: "shared", template: {
    nodes: [{ id: "check", kind: "script", config: { scriptName: "check", gateMode: "gate" } }], edges: [],
  } } }, { id: "end", kind: "end" }],
  edges: [{ from: "start", to: "steps" }, { from: "steps", to: "end", condition: "success" }],
};
pgDescribe("deterministic script task projection candidate", () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: "fusion_a2_red", poolMax: 4 });
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
    const executor = new WorkflowGraphExecutor({ handlers: { script: async () => {
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
    const executor = new WorkflowGraphExecutor({ signal: abort.signal, handlers: { script: async () => {
      if (ending === "cancelled") abort.abort();
      return { outcome: ending === "failure" ? "failure" : "success", value: ending === "advisory-failed" ? "failed" : undefined,
        contextPatch: { scriptSucceeded: ending !== "failure" && ending !== "advisory-failed", ...(ending === "skipped" ? { notRunReason: "execution-mode-skip" } : {}) } };
    } } });
    await executor.run(task, { experimentalFeatures: { workflowGraphExecutor: true } }, ir);
    expect((await h.store().getTask(task.id)).steps[0].status).not.toBe("done");
  });
  it.each(["reset-replan", "checkout-release"] as const)("refuses stale native completion after %s while command is in flight", async (supersession) => {
    const store = h.store();
    const task = await fixture();
    const start = await store.startStep(task.id, 0, { source: "graph" });
    expect(start.accepted).toBe(true);
    let finishCommand!: () => void;
    const command = new Promise<void>((resolve) => { finishCommand = resolve; });
    // This is the proposed callback's existing native API, deliberately without a new production fence.
    const lateCompletion = command.then(() => store.updateStep(task.id, 0, "done", { source: "graph" }));
    if (supersession === "reset-replan") {
      await store.resetTaskPublication(task.id, "todo");
      await store.updateTask(task.id, { steps: [{ name: "New owner's assertion", status: "pending" }], checkedOutBy: "agent-new", checkoutNodeId: "host-new", checkoutRunId: "run-new", checkoutLeaseEpoch: 2 });
    } else {
      await store.updateTask(task.id, { checkedOutBy: undefined, checkoutNodeId: undefined, checkoutRunId: undefined });
    }
    const superseded = await store.getTask(task.id);
    if (supersession === "reset-replan") {
      expect(superseded).toMatchObject({ checkoutRunId: "run-new", checkoutLeaseEpoch: 2 });
      expect(superseded.steps[0]).toMatchObject({ name: "New owner's assertion", status: "pending" });
    } else {
      expect(superseded.checkedOutBy).toBeUndefined();
      expect(superseded.checkoutRunId).toBeUndefined();
    }
    finishCommand();
    await lateCompletion;
    const current = await store.getTask(task.id);
    expect(current.steps[0].status).not.toBe("done");
    if (supersession === "reset-replan") expect(current.steps[0].name).toBe("New owner's assertion");
  });
});
