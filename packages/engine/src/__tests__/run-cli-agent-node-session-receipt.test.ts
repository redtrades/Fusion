// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDetail, WorkflowIrNode } from "@fusion/core";
import { runCliAgentNode, type RunCliAgentNodeDeps } from "../executor/run-cli-agent-node.js";
import { runGraphCustomNode, type RunGraphCustomNodeDeps } from "../executor/run-graph-custom-node.js";
import { materializedTemplateNodeId } from "../workflows/workflow-graph-executor.js";
import { CliConcurrencyLimitError } from "../cli-agent/session-manager.js";
import type { CliTaskOutcomeKind } from "../cli-agent/task-session.js";

const { launch, killLive } = vi.hoisted(() => ({ launch: vi.fn(), killLive: vi.fn() }));
vi.mock("../cli-agent/task-session.js", () => ({
  launchCliTaskSession: launch,
  killLiveTaskSessions: killLive,
}));

function fixture() {
  const live = { id: "FN-RECEIPT", worktree: "/fixture/admitted-worktree" } as TaskDetail;
  const node: WorkflowIrNode = { id: "implement", kind: "prompt" };
  const reap = vi.fn(async () => {});
  const deps = {
    store: { logEntry: vi.fn(async () => {}) },
    getRunContextFor: () => undefined,
    activeCliTaskSessions: new Map(),
    cliAgentRuntime: { manager: {}, hub: {}, registry: {}, store: {}, projectId: "fixture-project", hookEndpointUrl: "http://fixture.invalid" },
    reapCliTaskSessionForHandoff: reap,
  } as unknown as RunCliAgentNodeDeps;
  return { live, node, deps, reap, config: { cliAdapterId: "fixture-adapter", prompt: "admitted prompt" } };
}

describe("native CLI node session receipt", () => {
  beforeEach(() => { launch.mockReset(); killLive.mockReset(); });

  it.each([
    ["success", "success", "cli-agent-done"],
    ["killed", "failure", "cli-agent-killed"],
    ["auth-failed", "failure", "cli-agent-auth-failed"],
    ["user-exited", "failure", "cli-agent-user-exited"],
    ["needs-attention", "failure", "cli-agent-needs-attention"],
  ] as const)("retains exact session identity for launched %s without changing classification", async (kind: CliTaskOutcomeKind, outcome, value) => {
    const f = fixture();
    const session = { result: vi.fn(async () => ({ kind, sessionId: `exact-${kind}` })) };
    launch.mockResolvedValue(session);
    const result = await runCliAgentNode(f.deps, f.node, f.live, f.config);
    expect(result).toEqual({ outcome, value, contextPatch: { "node:implement:cliSessionId": `exact-${kind}` } });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0][0]).toMatchObject({ taskId: f.live.id, projectId: "fixture-project", worktreePath: f.live.worktree, prompt: "admitted prompt" });
    expect(f.deps.activeCliTaskSessions.size).toBe(0);
    if (kind === "success") expect(f.reap).toHaveBeenCalledWith(session, f.live.id);
    else expect(f.reap).not.toHaveBeenCalled();
  });

  it("preserves distinct concrete foreach receipts through the native custom-node call site", async () => {
    const f = fixture();
    f.node.config = { ...f.config, executor: "cli-agent" };
    const runNative = vi.fn((node: WorkflowIrNode, live: TaskDetail, cfg: Record<string, unknown>, runtimeNodeId?: string) => runCliAgentNode(f.deps, node, live, cfg, runtimeNodeId));
    const graphDeps = {
      store: { getTask: async () => f.live },
      resolveWorkflowInputMarkerForGraphNode: async () => undefined,
      runCliAgentNode: runNative,
    } as unknown as RunGraphCustomNodeDeps;
    const receipts: Record<string, unknown> = {};
    for (const [callIndex, stepIndex] of [undefined, 0, 1].entries()) {
      const context: Record<string, unknown> = stepIndex === undefined ? {} : { "foreach:active": { foreachNodeId: "steps", stepIndex } };
      const runtimeNodeId = materializedTemplateNodeId(f.node, context);
      if (stepIndex !== undefined) context["workflow:node-instance-id"] = runtimeNodeId;
      launch.mockResolvedValue({ result: async () => ({ kind: "success", sessionId: `session-${stepIndex}` }) });
      const result = await runGraphCustomNode(graphDeps, f.node, f.live, {} as never, undefined, context);
      Object.assign(receipts, result.contextPatch);
      expect(runNative.mock.calls[callIndex][3]).toBe(runtimeNodeId);
    }
    expect(receipts).toEqual({ "node:implement:cliSessionId": "session-undefined", "node:steps#0:implement:cliSessionId": "session-0", "node:steps#1:implement:cliSessionId": "session-1" });
    expect(launch).toHaveBeenCalledTimes(3);
  });

  it("keeps a launch-time capacity refusal without fabricating session identity", async () => {
    const f = fixture();
    launch.mockRejectedValue(new CliConcurrencyLimitError(1, 1));
    const result = await runCliAgentNode(f.deps, f.node, f.live, f.config);
    expect(result).toEqual({ outcome: "failure", value: "cli-agent-at-capacity" });
    expect(f.deps.activeCliTaskSessions.size).toBe(0);
    expect(f.reap).not.toHaveBeenCalled();
  });

  it.each(["runtime", "worktree", "adapter"] as const)("does not invent a receipt for prelaunch %s refusal", async missing => {
    const f = fixture();
    if (missing === "runtime") f.deps.cliAgentRuntime = null;
    if (missing === "worktree") f.live.worktree = null;
    if (missing === "adapter") f.config.cliAdapterId = "";
    const result = await runCliAgentNode(f.deps, f.node, f.live, f.config);
    expect(result.outcome).toBe("failure");
    expect(result.contextPatch).toBeUndefined();
    expect(launch).not.toHaveBeenCalled();
  });
});
