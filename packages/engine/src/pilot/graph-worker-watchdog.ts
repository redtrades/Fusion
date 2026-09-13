import type { ChildProcess } from "node:child_process";

export type ProcessLiveness = "alive" | "gone" | "unknown";
export interface WorkerSample { leaseRenewedAt: number; progress: number }
export interface WorkerStuck {
  state: "worker-stuck";
  attemptId: string;
  nodeId: string;
  observedAt: number;
  evidence: {
    pid: number;
    process: "gone";
    leaseAgeMs: number;
    leaseFresh: boolean;
    progress: number;
    progressAgeMs: number;
  };
}

export function probeProcess(pid: number): ProcessLiveness {
  try { process.kill(pid, 0); return "alive"; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "unknown"; }
}

/**
 * FNXC:GraphWorkerPilot 2026-09-13-21:27:
 * WS 1.11 observes the actual child lifetime outside the agent and lease-renewal loop.
 * A fresh lease cannot excuse a gone process with unchanged progress. Alive/unknown
 * processes never time out here. No LLM, process kill, retry, or restart capability.
 * Two polls allow buffered final progress to settle; poll <= lease/3 bounds death
 * detection within one lease window while this host event loop remains schedulable.
 */
export function observeGraphWorker(options: {
  attemptId: string;
  nodeId: string;
  child: ChildProcess;
  leaseWindowMs: number;
  pollMs: number;
  read: () => WorkerSample;
  record: (terminal: WorkerStuck) => void;
  probe?: (pid: number) => ProcessLiveness;
}) {
  const { child, leaseWindowMs, pollMs } = options;
  if (!Number.isSafeInteger(child.pid) || child.pid! <= 0 || !options.attemptId || !options.nodeId
      || !Number.isFinite(leaseWindowMs) || leaseWindowMs < 3
      || !Number.isInteger(pollMs) || pollMs < 1 || pollMs > leaseWindowMs / 3) {
    throw new Error("Watchdog requires a spawned child, attempt/node identity, and 0 < poll <= lease/3");
  }
  const pid = child.pid!;
  const controller = new AbortController();
  let stopped = false;
  let exited = child.exitCode !== null || child.signalCode !== null;
  const onExit = () => { exited = true; };
  child.once("exit", onExit);
  let deathObserved = false;
  let progress = -1;
  let progressAt = Date.now();
  const read = () => {
    const sample = options.read();
    if (!Number.isFinite(sample.leaseRenewedAt) || sample.leaseRenewedAt > Date.now()
        || !Number.isSafeInteger(sample.progress) || sample.progress < 0 || sample.progress < progress) {
      throw new Error("Invalid lease or non-monotonic progress for bound attempt");
    }
    return sample;
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    stopped = true;
    if (timer) clearInterval(timer);
    child.removeListener("exit", onExit);
  };
  let initial: WorkerSample;
  try { initial = read(); } catch (error) { stop(); throw error; }
  progress = initial.progress;
  const terminal = new Promise<WorkerStuck>((resolve, reject) => {
    timer = setInterval(() => {
      if (stopped) return;
      try {
        const now = Date.now();
        const sample = read();
        const liveness = exited || deathObserved ? "gone" : (options.probe ?? probeProcess)(pid);
        const alreadyGone = deathObserved;
        if (liveness === "gone") deathObserved = true;
        // FNXC:GraphWorkerPilot 2026-09-13-21:42: Freeze worker progress after one death observation; descendant/pipe bytes cannot renew life.
        if (!alreadyGone && sample.progress > progress) {
          progress = sample.progress;
          progressAt = now;
          return;
        }
        if (liveness !== "gone") return;
        const leaseAgeMs = now - sample.leaseRenewedAt;
        const record: WorkerStuck = {
          state: "worker-stuck", attemptId: options.attemptId, nodeId: options.nodeId, observedAt: now,
          evidence: { pid, process: "gone", leaseAgeMs, leaseFresh: leaseAgeMs <= leaseWindowMs,
            progress, progressAgeMs: now - progressAt },
        };
        stop();
        options.record(record);
        controller.abort("worker-stuck");
        resolve(record);
      } catch (error) {
        stop();
        controller.abort("watchdog-error");
        reject(error);
      }
    }, pollMs);
  });
  // FNXC:GraphWorkerPilot 2026-09-13-21:27: The observer can fail before a caller attaches its graph race.
  void terminal.catch(() => undefined);
  return {
    signal: controller.signal,
    stop,
    async race<T>(graph: Promise<T>): Promise<T | WorkerStuck> {
      try { return await Promise.race([terminal, graph]); }
      finally { stop(); }
    },
  };
}
