import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { TaskStore } from "../store.js";
import type { Task, WorkflowWorkItem, WorkflowWorkItemUpsertInput } from "../types.js";
import type { DbTransaction } from "../postgres/data-layer.js";
import * as schema from "../postgres/schema/index.js";
import { hashWorkflowIr } from "../workflows/workflow-ir-resolver.js";
import type { WorkflowIr } from "../workflows/workflow-ir-types.js";
import { parseWorkflowIr } from "../workflows/workflow-ir.js";
import { acquireTaskAdvisoryXactLock } from "./task-advisory-lock.js";
import { readTaskRowInTransaction, upsertTaskRowInTransaction } from "./async/async-persistence.js";
import { getWorkflowWorkItem, replaceActiveTaskWorkflowContinuation, withTaskWorkflowSerialization } from "./async/async-workflow-workitems.js";
import type { WorkflowOverlayAdmission, StoredWorkflowOverlayState, WorkflowOverlayStateWrite } from "./task-mutation-ops.js";
import { WORKFLOW_OVERLAY_MAX_BYTES } from "./task-mutation-ops.js";

export interface WorkflowOverlayCurrentTerminal {
  graphRunId: string;
  operationId: string;
  receiptIndex: number;
  heldWorkItemId: string;
  blockingNodeId: string;
  workflowIrHash: string;
  column: string;
  state: "held" | "released";
  release?: { operationId: string; successorId: string; admission: WorkflowOverlayAdmission; currentAdmittedWorkItemId?: string; currentAdmittedNodeInstanceId?: string };
}
type Namespace = { runs: Record<string, StoredWorkflowOverlayState>; currentTerminal?: WorkflowOverlayCurrentTerminal | null };
const identity = (taskId: string, operationId: string, kind: string, graphRunId: string) => `overlay-${kind}:${createHash("sha256").update(JSON.stringify([taskId, graphRunId, operationId])).digest("hex")}`;
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 256;
const owns = (task: Task, admission: WorkflowOverlayAdmission) => task.checkoutRunId === admission.runId
  && task.checkoutLeaseEpoch === admission.leaseEpoch && task.checkedOutBy === admission.agentId && task.checkoutNodeId === admission.nodeId;

/** FNXC:WorkflowOverlayRelease 2026-09-14-04:02: Pin an explicit custom definition on this transaction; builtin/default prompt configuration is not a supported release binding. */
async function readReleaseIr(store: TaskStore, tx: DbTransaction, taskId: string) {
  const projectId = store.asyncLayer!.projectId!;
  const [selection] = await tx.select().from(schema.project.taskWorkflowSelection)
    .where(and(eq(schema.project.taskWorkflowSelection.projectId, projectId), eq(schema.project.taskWorkflowSelection.taskId, taskId))).for("share");
  if (!selection || selection.workflowId.startsWith("builtin:")) return undefined;
  const [definition] = await tx.select().from(schema.project.workflows)
    .where(and(eq(schema.project.workflows.projectId, projectId), eq(schema.project.workflows.id, selection.workflowId))).for("share");
  if (!definition) return undefined;
  try { return parseWorkflowIr(definition.ir as string | WorkflowIr); } catch { return undefined; }
}

/** FNXC:WorkflowOverlayRelease 2026-09-14-04:02: Only native top-level nodes are resumable. Legacy unsupported receipts remain paused, with no release authority. */
export async function holdWorkflowOverlayTerminalInTransaction(store: TaskStore, tx: DbTransaction, task: Task, request: WorkflowOverlayStateWrite): Promise<void> {
  const namespace = task.sourceMetadata!.procedureEngineLive as Namespace;
  namespace.currentTerminal = null;
  const receipt = request.nextState.receipts.at(-1)!;
  const terminal = (receipt.terminalBlock ?? receipt.terminal) as Record<string, unknown>;
  if (!validId(terminal.blockingNodeId)) return;
  const ir = await readReleaseIr(store, tx, task.id);
  const node = ir?.nodes.find(node => node.id === terminal.blockingNodeId);
  if (!ir || !node || node.column !== task.column) return;
  const irHash = hashWorkflowIr(ir);
  const held = await replaceActiveTaskWorkflowContinuation(store.asyncLayer!, {
    taskId: task.id, kind: "task", runId: identity(task.id, request.operationId, "held", request.nextState.runId), nodeId: node.id,
    state: "held", sourceColumn: task.column, targetColumn: task.column, irHash,
    stableWorkflowRunId: request.nextState.runId, blockedReason: terminal.reason as string,
  }, tx);
  namespace.currentTerminal = { graphRunId: request.nextState.runId, operationId: request.operationId,
    receiptIndex: request.nextState.phaseCount - 1, heldWorkItemId: held.id,
    blockingNodeId: node.id, workflowIrHash: irHash, column: task.column, state: "held" };
  if (Buffer.byteLength(JSON.stringify(namespace), "utf8") > WORKFLOW_OVERLAY_MAX_BYTES) throw new Error("workflow overlay terminal metadata exceeds bound");
}

export interface WorkflowOverlayReleaseRequest {
  expectedTerminalOperationId: string;
  expectedGraphRunId: string;
  releaseOperationId: string;
  admission: WorkflowOverlayAdmission;
  expectedWorkflowIrHash: string;
}
export type WorkflowOverlayReleaseResult =
  | { applied: true; task: Task; successor: WorkflowWorkItem; replayed: boolean }
  | { applied: false; reason: "unavailable" | "invalid-input" | "task-missing" | "task-deleted" | "ownership-mismatch" | "terminal-superseded" | "workflow-mismatch" };

/**
 * FNXC:WorkflowOverlayRelease 2026-09-14-04:02:
 * Trusted-caller primitive, NOT an actor authorization service. The outer binding must authorize
 * the durable receipt's human/orchestrator resumeActor using authenticated current policy.
 * Current checkout admission is necessary but does not prove human approval. Reset cancels the
 * native held/successor item; retained metadata never authorizes resurrection. Publication and
 * pause clearing share one transaction, while exact retries only read a still-active successor.
 */
export async function releaseWorkflowOverlayTerminalFencedImpl(store: TaskStore, id: string, input: WorkflowOverlayReleaseRequest): Promise<WorkflowOverlayReleaseResult> {
  const layer = store.asyncLayer;
  if (!layer?.projectId) return { applied: false, reason: "unavailable" };
  let request: WorkflowOverlayReleaseRequest;
  try { request = JSON.parse(JSON.stringify(input)); } catch { return { applied: false, reason: "invalid-input" }; }
  if (!request || !request.admission || ![request.expectedTerminalOperationId, request.expectedGraphRunId, request.releaseOperationId,
    request.expectedWorkflowIrHash, request.admission.runId, request.admission.agentId, request.admission.nodeId].every(validId)
    || !Number.isSafeInteger(request.admission.leaseEpoch) || request.admission.leaseEpoch < 0) return { applied: false, reason: "invalid-input" };
  return store.withTaskLock(id, async () => {
    const result = await layer.transactionImmediate(async (tx): Promise<WorkflowOverlayReleaseResult> => {
      await acquireTaskAdvisoryXactLock(tx, layer.projectId, id);
      return withTaskWorkflowSerialization(tx, layer.projectId, id, async () => {
        await tx.select({ id: schema.project.tasks.id }).from(schema.project.tasks)
          .where(and(eq(schema.project.tasks.id, id), eq(schema.project.tasks.projectId, layer.projectId!))).for("update");
        const row = await readTaskRowInTransaction(tx, id, { includeDeleted: true }, layer.projectId);
        if (!row) return { applied: false, reason: "task-missing" };
        if (row.deletedAt) return { applied: false, reason: "task-deleted" };
        const task = store.rowToTask(store.pgRowToTaskRow(row));
        if (!owns(task, request.admission)) return { applied: false, reason: "ownership-mismatch" };
        const namespace = task.sourceMetadata?.procedureEngineLive as Namespace | undefined;
        const terminal = namespace?.currentTerminal;
        if (!terminal || terminal.graphRunId !== request.expectedGraphRunId || terminal.operationId !== request.expectedTerminalOperationId || terminal.column !== task.column) return { applied: false, reason: "terminal-superseded" };
        const checkpoint = namespace!.runs[terminal.graphRunId];
        const receipt = checkpoint?.receipts[terminal.receiptIndex];
        const block = (receipt?.terminalBlock ?? receipt?.terminal) as Record<string, unknown> | undefined;
        if (!block || block.blockingNodeId !== terminal.blockingNodeId) return { applied: false, reason: "terminal-superseded" };
        const ir = await readReleaseIr(store, tx, id);
        if (!ir || terminal.workflowIrHash !== request.expectedWorkflowIrHash || hashWorkflowIr(ir) !== terminal.workflowIrHash
          || !ir.nodes.some(node => node.id === terminal.blockingNodeId && node.column === task.column)) return { applied: false, reason: "workflow-mismatch" };
        if (terminal.state === "released") {
          const release = terminal.release;
          const successor = release && await getWorkflowWorkItem(tx, release.successorId, layer.projectId);
          if (!release || release.operationId !== request.releaseOperationId || !successor
            || !["runnable", "running", "retrying"].includes(successor.state)
            || successor.runId !== identity(id, request.releaseOperationId, "release", terminal.graphRunId) || successor.taskId !== id
            || successor.nodeId !== terminal.blockingNodeId || successor.irHash !== terminal.workflowIrHash
            || task.paused || !isDeepStrictEqual(release.admission, request.admission)) return { applied: false, reason: "terminal-superseded" };
          return { applied: true, task, successor, replayed: true };
        }
        // FNXC:WorkflowOverlayRelease 2026-09-14-01:20: Retire only this held terminal's fence; native A4 still rejects checkpoint replays after release.
        if (checkpoint.runId !== terminal.graphRunId || checkpoint.phaseCount !== terminal.receiptIndex + 1
          || checkpoint.receipts.length !== checkpoint.phaseCount || checkpoint.writeFence?.operationId !== terminal.operationId
          || checkpoint.writeFence.expectedPhaseCount !== terminal.receiptIndex
          || checkpoint.writeFence.terminal?.targetColumn !== terminal.column) return { applied: false, reason: "terminal-superseded" };
        if (!await isCurrentHeldTerminal(store, tx, task, terminal, block)) return { applied: false, reason: "terminal-superseded" };
        const collisions = await tx.select({ id: schema.project.workflowWorkItems.id }).from(schema.project.workflowWorkItems)
          .where(and(eq(schema.project.workflowWorkItems.projectId, layer.projectId!), eq(schema.project.workflowWorkItems.taskId, id),
            eq(schema.project.workflowWorkItems.runId, identity(id, request.releaseOperationId, "release", terminal.graphRunId))));
        if (collisions.length) return { applied: false, reason: "terminal-superseded" };
        const successor = await replaceActiveTaskWorkflowContinuation(layer, {
          taskId: id, kind: "task", runId: identity(id, request.releaseOperationId, "release", terminal.graphRunId), nodeId: terminal.blockingNodeId,
          state: "runnable", sourceColumn: task.column, targetColumn: task.column, irHash: terminal.workflowIrHash,
          stableWorkflowRunId: terminal.graphRunId,
        }, tx);
        delete checkpoint.writeFence.terminal;
        terminal.state = "released";
        terminal.release = { operationId: request.releaseOperationId, successorId: successor.id, admission: request.admission };
        task.paused = false; task.status = "idle"; task.pausedReason = undefined; task.error = undefined; task.pausedByAgentId = undefined;
        task.updatedAt = new Date().toISOString();
        if (Buffer.byteLength(JSON.stringify(namespace), "utf8") > WORKFLOW_OVERLAY_MAX_BYTES) throw new Error("workflow overlay release metadata exceeds bound");
        await upsertTaskRowInTransaction(tx, task as unknown as Record<string, unknown>, store.createTaskPersistSerializationContext(task), layer.projectId);
        return { applied: true, task, successor, replayed: false };
      });
    });
    if (result.applied) {
      await store.writeTaskJsonFile(store.taskDir(id), result.task);
      if (store.isWatching) store.taskCache.set(id, { ...result.task });
      store.emitTaskLifecycleEventSafely("task:updated", [result.task]);
    }
    return result;
  });
}

async function isCurrentHeldTerminal(store: TaskStore, tx: DbTransaction, task: Task, terminal: WorkflowOverlayCurrentTerminal, block: Record<string, unknown>): Promise<boolean> {
  const held = await getWorkflowWorkItem(tx, terminal.heldWorkItemId, store.asyncLayer!.projectId);
  return terminal.state === "held" && !!held && held.state === "held" && held.taskId === task.id && held.kind === "task"
    && held.runId === identity(task.id, terminal.operationId, "held", terminal.graphRunId) && held.nodeId === terminal.blockingNodeId
    && held.irHash === terminal.workflowIrHash && task.paused === true && task.status === "paused"
    && task.pausedReason === block.reason && task.error === block.reason && task.userPaused !== true;
}

export type WorkflowOverlayCurrentTerminalResult =
  | { current: true; task: Task; terminal: WorkflowOverlayCurrentTerminal; terminalBlock: Record<string, unknown> }
  | { current: false };

/** FNXC:WorkflowOverlayRelease 2026-09-14-04:02: Read-only current hold projection; historical checkpoints and Reset-cancelled anchors are never active Board state. This is not release authorization. */
export async function readWorkflowOverlayCurrentTerminalImpl(store: TaskStore, id: string): Promise<WorkflowOverlayCurrentTerminalResult> {
  const layer = store.asyncLayer;
  if (!layer?.projectId) return { current: false };
  return layer.transactionImmediate(async (tx) => {
    await acquireTaskAdvisoryXactLock(tx, layer.projectId, id);
    return withTaskWorkflowSerialization(tx, layer.projectId, id, async () => {
      await tx.select({ id: schema.project.tasks.id }).from(schema.project.tasks)
        .where(and(eq(schema.project.tasks.id, id), eq(schema.project.tasks.projectId, layer.projectId!))).for("share");
      const row = await readTaskRowInTransaction(tx, id, { includeDeleted: true }, layer.projectId);
      if (!row || row.deletedAt) return { current: false };
      const task = store.rowToTask(store.pgRowToTaskRow(row));
      const namespace = task.sourceMetadata?.procedureEngineLive as Namespace | undefined;
      const terminal = namespace?.currentTerminal;
      if (!terminal || terminal.column !== task.column || terminal.state !== "held") return { current: false };
      const receipt = namespace!.runs[terminal.graphRunId]?.receipts[terminal.receiptIndex];
      const block = (receipt?.terminalBlock ?? receipt?.terminal) as Record<string, unknown> | undefined;
      if (!block || block.blockingNodeId !== terminal.blockingNodeId) return { current: false };
      const ir = await readReleaseIr(store, tx, id);
      if (!ir || hashWorkflowIr(ir) !== terminal.workflowIrHash
        || !ir.nodes.some(node => node.id === terminal.blockingNodeId && node.column === task.column)
        || !await isCurrentHeldTerminal(store, tx, task, terminal, block)) return { current: false };
      return { current: true, task, terminal, terminalBlock: block };
    });
  });
}

export interface WorkflowOverlayPrincipalFence {
  admission: WorkflowOverlayAdmission;
  graphRunId: string;
  workflowIrHash: string;
  resumedWorkItemId: string;
  loop?: { loopNodeId: string; iteration: number };
}
export type WorkflowOverlayPrincipalResult = { applied: true; workItem: WorkflowWorkItem; task: Task }
  | { applied: false; reason: "unavailable" | "scope-mismatch" | "ownership-mismatch" | "workflow-mismatch" | "not-applicable" };

/** FNXC:WorkflowOverlayRelease 2026-09-14-04:32: Validate only actual top-level or direct native loop instances; arbitrary nested aliases never establish authority. */
function principalNodeMatches(ir: WorkflowIr, nodeId: string, instanceId: string, loop?: WorkflowOverlayPrincipalFence["loop"]): boolean {
  if (!loop) return instanceId === nodeId && ir.nodes.some(node => node.id === nodeId);
  const container = ir.nodes.find(node => node.id === loop.loopNodeId && node.kind === "loop");
  const config = container?.config as { maxIterations?: number; template?: { nodes?: { id: string }[] } } | undefined;
  return !!config && Number.isSafeInteger(loop.iteration) && loop.iteration >= 1
    && Number.isSafeInteger(config.maxIterations) && loop.iteration <= config.maxIterations!
    && instanceId === `${container!.id}#${loop.iteration}:${nodeId}`
    && !!config.template?.nodes?.some(node => node.id === nodeId);
}

/** FNXC:WorkflowOverlayRelease 2026-09-14-04:32: Native principal admission transfers one active release pointer atomically. A caller supplies actual native continuation context, never human authorization. */
export async function replaceWorkflowOverlayReleasedPrincipalImpl(store: TaskStore, input: WorkflowWorkItemUpsertInput & { kind: "task" }, fence: WorkflowOverlayPrincipalFence): Promise<WorkflowOverlayPrincipalResult> {
  const layer = store.asyncLayer;
  if (!layer?.projectId) return { applied: false, reason: "unavailable" };
  const request = structuredClone({ input, fence });
  const id = request.input.taskId;
  return store.withTaskLock(id, async () => {
    const outcome = await layer.transactionImmediate(async tx => {
    await acquireTaskAdvisoryXactLock(tx, layer.projectId, id);
    return withTaskWorkflowSerialization(tx, layer.projectId, id, async (): Promise<WorkflowOverlayPrincipalResult> => {
      await tx.select({ id: schema.project.tasks.id }).from(schema.project.tasks)
        .where(and(eq(schema.project.tasks.id, id), eq(schema.project.tasks.projectId, layer.projectId!))).for("update");
      const row = await readTaskRowInTransaction(tx, id, { includeDeleted: true }, layer.projectId);
      if (!row || row.deletedAt) return { applied: false, reason: "scope-mismatch" };
      const task = store.rowToTask(store.pgRowToTaskRow(row));
      const { input: next, fence: expected } = request;
      const namespace = task.sourceMetadata?.procedureEngineLive as Namespace | undefined;
      const terminal = namespace?.currentTerminal;
      const release = terminal?.release;
      if (!terminal || terminal.state !== "released" || !release) return { applied: false, reason: "scope-mismatch" };
      const origin = await getWorkflowWorkItem(tx, expected.resumedWorkItemId, layer.projectId);
      if (!origin || origin.taskId !== task.id || origin.kind !== "task") return { applied: false, reason: "scope-mismatch" };
      const related = origin.id === release.successorId || (validId(origin.nodeInstanceId)
        && origin.stableWorkflowRunId === terminal.graphRunId
        && origin.runId === identity(task.id, JSON.stringify([release.operationId, origin.nodeInstanceId]), "principal", terminal.graphRunId));
      if (!related) return { applied: false, reason: "not-applicable" };
      if (task.paused || terminal.graphRunId !== expected.graphRunId || terminal.column !== task.column) return { applied: false, reason: "scope-mismatch" };
      if (!owns(task, expected.admission) || !isDeepStrictEqual(release.admission, expected.admission)) return { applied: false, reason: "ownership-mismatch" };
      const priorId = release.currentAdmittedWorkItemId ?? release.successorId;
      const prior = await getWorkflowWorkItem(tx, priorId, layer.projectId);
      if (!prior || prior.taskId !== task.id || prior.kind !== "task" || !["runnable", "running"].includes(prior.state)
        || prior.irHash !== terminal.workflowIrHash || prior.stableWorkflowRunId !== terminal.graphRunId
        || expected.resumedWorkItemId !== priorId) return { applied: false, reason: "scope-mismatch" };
      if (release.currentAdmittedWorkItemId
        ? prior.nodeInstanceId !== release.currentAdmittedNodeInstanceId || !prior.principalAgentId
          || prior.runId !== identity(task.id, JSON.stringify([release.operationId, prior.nodeInstanceId]), "principal", terminal.graphRunId)
        : prior.nodeId !== terminal.blockingNodeId || prior.runId !== identity(task.id, release.operationId, "release", terminal.graphRunId)) {
        return { applied: false, reason: "scope-mismatch" };
      }
      const ir = await readReleaseIr(store, tx, task.id);
      if (!ir || hashWorkflowIr(ir) !== terminal.workflowIrHash || expected.workflowIrHash !== terminal.workflowIrHash
        || next.irHash !== terminal.workflowIrHash || next.stableWorkflowRunId !== terminal.graphRunId
        || !validId(next.nodeInstanceId) || !principalNodeMatches(ir, next.nodeId, next.nodeInstanceId, expected.loop)
        || next.runId !== `${terminal.graphRunId}:${next.nodeInstanceId}` || next.state !== "running"
        || !validId(next.principalAgentId) || !next.workflowRole || !next.authorityKind) return { applied: false, reason: "workflow-mismatch" };
      const publication = { ...next, runId: identity(task.id, JSON.stringify([release.operationId, next.nodeInstanceId]), "principal", terminal.graphRunId) };
      const targets = await tx.select({ id: schema.project.workflowWorkItems.id }).from(schema.project.workflowWorkItems)
        .where(and(eq(schema.project.workflowWorkItems.projectId, layer.projectId!), eq(schema.project.workflowWorkItems.taskId, task.id),
          eq(schema.project.workflowWorkItems.kind, "task"), eq(schema.project.workflowWorkItems.runId, publication.runId), eq(schema.project.workflowWorkItems.nodeId, next.nodeId)));
      // A prior terminal principal row may share the native graph/node key. Never delete it to gain admission.
      if (targets.some(target => target.id !== prior.id)) return { applied: false, reason: "scope-mismatch" };
      if (targets.length) {
        if (prior.state !== "running" || prior.nodeInstanceId !== next.nodeInstanceId || prior.principalAgentId !== next.principalAgentId
          || prior.workflowRole !== next.workflowRole || prior.authorityKind !== next.authorityKind) return { applied: false, reason: "scope-mismatch" };
        return { applied: true, workItem: prior, task };
      }
      const workItem = await replaceActiveTaskWorkflowContinuation(layer, publication, tx);
      release.currentAdmittedWorkItemId = workItem.id;
      release.currentAdmittedNodeInstanceId = next.nodeInstanceId;
      if (Buffer.byteLength(JSON.stringify(namespace), "utf8") > WORKFLOW_OVERLAY_MAX_BYTES) throw new Error("workflow overlay principal metadata exceeds bound");
      await tx.update(schema.project.tasks).set({ sourceMetadata: task.sourceMetadata }).where(and(eq(schema.project.tasks.id, task.id), eq(schema.project.tasks.projectId, layer.projectId!)));
      return { applied: true, workItem, task };
    });
    });
    if (outcome.applied) {
      await store.writeTaskJsonFile(store.taskDir(id), outcome.task);
      if (store.isWatching) store.taskCache.set(id, { ...outcome.task });
      store.emitTaskLifecycleEventSafely("task:updated", [outcome.task]);
    }
    return outcome;
  }).catch((): WorkflowOverlayPrincipalResult => ({ applied: false, reason: "unavailable" }));
}

export interface WorkflowOverlayReleasedAdmissionQuery {
  admission: WorkflowOverlayAdmission;
  graphRunId: string;
  workItemId: string;
  nodeInstanceId: string;
}
export type WorkflowOverlayReleasedAdmissionResult = { valid: true; terminal: WorkflowOverlayCurrentTerminal; workItem: WorkflowWorkItem }
  | { valid: false; reason: "unavailable" | "scope-mismatch" };

/** FNXC:WorkflowOverlayRelease 2026-09-14-04:32: The plugin consumes only the current admitted native row; Reset/ordinary replacement invalidate it despite retained release metadata. */
export async function readWorkflowOverlayReleasedAdmissionImpl(store: TaskStore, id: string, input: WorkflowOverlayReleasedAdmissionQuery): Promise<WorkflowOverlayReleasedAdmissionResult> {
  const layer = store.asyncLayer;
  if (!layer?.projectId) return { valid: false, reason: "unavailable" };
  const request = structuredClone(input);
  return layer.transactionImmediate(async tx => {
    await acquireTaskAdvisoryXactLock(tx, layer.projectId, id);
    return withTaskWorkflowSerialization(tx, layer.projectId, id, async (): Promise<WorkflowOverlayReleasedAdmissionResult> => {
      await tx.select({ id: schema.project.tasks.id }).from(schema.project.tasks)
        .where(and(eq(schema.project.tasks.id, id), eq(schema.project.tasks.projectId, layer.projectId!))).for("share");
      const row = await readTaskRowInTransaction(tx, id, { includeDeleted: true }, layer.projectId);
      if (!row || row.deletedAt) return { valid: false, reason: "scope-mismatch" };
      const task = store.rowToTask(store.pgRowToTaskRow(row));
      const terminal = (task.sourceMetadata?.procedureEngineLive as Namespace | undefined)?.currentTerminal;
      const release = terminal?.release;
      if (!terminal || terminal.state !== "released" || !release || task.paused || task.column !== terminal.column
        || terminal.graphRunId !== request.graphRunId || !owns(task, request.admission)
        || !isDeepStrictEqual(release.admission, request.admission) || release.currentAdmittedWorkItemId !== request.workItemId
        || release.currentAdmittedNodeInstanceId !== request.nodeInstanceId) return { valid: false, reason: "scope-mismatch" };
      const workItem = await getWorkflowWorkItem(tx, request.workItemId, layer.projectId);
      const ir = await readReleaseIr(store, tx, id);
      if (!workItem || workItem.taskId !== id || workItem.kind !== "task" || workItem.state !== "running"
        || !workItem.principalAgentId || workItem.nodeInstanceId !== request.nodeInstanceId
        || workItem.runId !== identity(id, JSON.stringify([release.operationId, request.nodeInstanceId]), "principal", terminal.graphRunId)
        || workItem.irHash !== terminal.workflowIrHash || workItem.stableWorkflowRunId !== terminal.graphRunId
        || !ir || hashWorkflowIr(ir) !== terminal.workflowIrHash) return { valid: false, reason: "scope-mismatch" };
      return { valid: true, terminal, workItem };
    });
  });
}
