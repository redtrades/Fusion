import type { TaskDetail, TaskStep, TaskStore } from "@fusion/core";

export interface DeterministicStepProjection {
  start(stepIndex: number): Promise<boolean>;
  complete(stepIndex: number): Promise<boolean>;
}

/** FNXC:DeterministicStepProjection 2026-09-14-06:19:
 * Capture the admitted native owner and ordered plan once per foreach expansion. Neither scripts
 * nor their outputs choose the task, step definition, or lease used by the protected store writer.
 */
export function createDeterministicStepProjection(
  store: TaskStore,
  task: TaskDetail,
  steps: TaskStep[],
  signal: AbortSignal,
): DeterministicStepProjection {
  const options = {
    source: "graph" as const,
    ownership: { runId: task.checkoutRunId ?? "", agentId: task.checkedOutBy ?? "", nodeId: task.checkoutNodeId ?? "", leaseEpoch: task.checkoutLeaseEpoch ?? 0 },
    expectedSteps: structuredClone(steps.map(({ status: _status, ...definition }) => definition)),
    signal,
  };
  const taskId = task.id;
  return {
    start: async (index) => (await store.startStep(taskId, index, options)).accepted,
    complete: async (index) => (await store.updateStep(taskId, index, "done", options)).steps[index]?.status === "done",
  };
}
