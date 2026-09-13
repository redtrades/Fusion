import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PrInfo, TaskStore } from "@fusion/core";
import { emitBoundedRunAudit } from "./emit-bounded-run-audit.js";
import { readLeaseArtifact, type LeaseArtifact } from "./lease-artifacts.js";
type Progress = {
  status: "unknown" | "progressing" | "unchanged" | "spinning";
  zero_delta_streak: number;
  pr_head_changed: boolean | null;
  ci_state_changed: boolean | null;
  review_state_changed: boolean | null;
};
export type LeaseAuditEvent = {
  schema_version: 1;
  event: "lease_renewed";
  claim_id: string;
  task_id: string;
  worker_id: string;
  lease_epoch: number;
  node_id: string;
  run_id: string | null;
  at: string;
  observed_at: string;
  artifacts: LeaseArtifact[];
  progress: Progress;
};

/**
 * FNXC:LeaseAudit 2026-09-13-21:27:
 * WS 1.12 observes successful executor renewals without changing lease authority. Claim identity
 * includes the epoch and run so a replacement executor never inherits another worker's streak.
 * Only GitHub-observed PR fields are compared; worker text, counters and attestation are excluded.
 * Three consecutive complete, fresh zero-delta renewals flag spinning for the lead, never pause it.
 */
function progressSince(previous: LeaseAuditEvent | undefined, current: LeaseAuditEvent): Progress {
  const unknown: Progress = { status: "unknown", zero_delta_streak: 0,
    pr_head_changed: null, ci_state_changed: null, review_state_changed: null };
  if (!previous || !previous.artifacts.length || !current.artifacts.length) return unknown;
  const before = previous.artifacts;
  const after = current.artifacts;
  if (after.some((pr) => !pr.observed_at ||
    Date.parse(pr.observed_at) <= Date.parse(previous.observed_at) ||
    !(Date.parse(pr.observed_at) <= Date.parse(current.observed_at)))) return unknown;
  if (JSON.stringify(before.map((pr) => pr.pr)) !== JSON.stringify(after.map((pr) => pr.pr))) return unknown;
  const delta = (key: "head" | "ci" | "review"): boolean | null => {
    if (after.some((pr, i) => pr[key] !== null && before[i][key] !== null && pr[key] !== before[i][key])) return true;
    if (after.some((pr, i) => pr[key] === null || before[i][key] === null)) return null;
    return false;
  };
  const changes = { pr_head_changed: delta("head"), ci_state_changed: delta("ci"), review_state_changed: delta("review") };
  if (Object.values(changes).includes(true)) return { ...unknown, ...changes, status: "progressing" };
  if (Object.values(changes).includes(null)) return { ...unknown, ...changes };
  const streak = previous.progress.zero_delta_streak + 1;
  return { ...changes, zero_delta_streak: streak, status: streak >= 3 ? "spinning" : "unchanged" };
}

/** Read-only claim join. Missing files mean no observations, never a spinning verdict. */
export async function readLeaseAuditHistory(file: string, claimId?: string): Promise<LeaseAuditEvent[]> {
  let contents: string;
  try { contents = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return contents.split("\n").filter((line) => line.trim()).map((line) => {
    const event = JSON.parse(line) as LeaseAuditEvent;
    if (event.schema_version !== 1 || event.event !== "lease_renewed") throw new Error("Unsupported lease audit event");
    return event;
  }).filter((event) => claimId === undefined || event.claim_id === claimId);
}

const pendingAppends = new Map<string, Promise<void>>();

async function appendRenewal(file: string, event: LeaseAuditEvent): Promise<void> {
  const append = (pendingAppends.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const history = await readLeaseAuditHistory(file, event.claim_id);
    const previous = history.at(-1);
    event.progress = progressSince(previous, event);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  pendingAppends.set(file, append);
  try { await append; }
  finally { if (pendingAppends.get(file) === append) pendingAppends.delete(file); }
}

/**
 * FNXC:LeaseAudit 2026-09-13-21:27:
 * Both the optional artifact read and JSONL sink use the existing bounded telemetry seam. Missing,
 * rejecting or hanging observation cannot fail a successful renewal or become lifecycle control.
 * The local append-only file survives executor restarts; the controller's task store owns its path.
 */
export async function observeLeaseRenewal(
  store: TaskStore, taskId: string, workerId: string, leaseEpoch: number,
  nodeId: string, runId: string | undefined, at: string,
): Promise<void> {
  const marker = { mutationType: "task:lease-renewed" };
  await emitBoundedRunAudit({ recordRunAuditEvent: async () => {
    const file = join(store.getTaskDir(taskId), "lease-audit.jsonl");
    let artifacts: LeaseArtifact[] = [];
    await emitBoundedRunAudit({ recordRunAuditEvent: async () => {
      const task = await store.getTask(taskId);
      const prs: PrInfo[] = task.prInfos?.length ? task.prInfos : task.prInfo ? [task.prInfo] : [];
      artifacts = (await Promise.all([...new Set(prs.map((pr) => pr.url))].map(readLeaseArtifact)))
        .sort((a, b) => a.pr.localeCompare(b.pr));
    } }, { mutationType: "task:lease-artifacts-observed" });
    const event: LeaseAuditEvent = {
      schema_version: 1, event: "lease_renewed",
      claim_id: JSON.stringify([taskId, workerId, leaseEpoch, nodeId, runId ?? null]),
      task_id: taskId, worker_id: workerId, lease_epoch: leaseEpoch,
      node_id: nodeId, run_id: runId ?? null, at, observed_at: new Date().toISOString(), artifacts,
      progress: { status: "unknown", zero_delta_streak: 0,
        pr_head_changed: null, ci_state_changed: null, review_state_changed: null },
    };
    await appendRenewal(file, event);
  } }, marker, { timeoutMs: 4_000 });
}
