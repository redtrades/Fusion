import type { ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { superviseSpawn, type TaskDetail, type WorkflowIr } from "@fusion/core";
import { WorkflowGraphExecutor } from "../workflows/workflow-graph-executor.js";
import { observeGraphWorker, probeProcess, type WorkerStuck } from "./graph-worker-watchdog.js";

const pilotGraph: WorkflowIr = {
  version: "v1", name: "dead-worker-pilot",
  nodes: [
    { id: "start", kind: "start" }, { id: "work", kind: "prompt" },
    { id: "recover", kind: "prompt" }, { id: "end", kind: "end" },
  ],
  edges: [
    { from: "start", to: "work" }, { from: "work", to: "end", condition: "success" },
    { from: "work", to: "recover", condition: "failure" }, { from: "recover", to: "end" },
  ],
};

function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}

export interface PilotResult {
  state: "worker-stuck" | "completed" | "failed";
  attemptId: string;
  visitedNodeIds: string[];
}

/**
 * FNXC:GraphWorkerPilot 2026-09-13-21:27:
 * Opt-in single-host pilot: the real WorkflowGraphExecutor drives one command-backed
 * agent node. Its lease owner survives child death. The observer owns a separate
 * timer and durable terminal record; cancellation prevents failure-edge redispatch.
 * The live dashboard/TaskStore is intentionally untouched. No model is selected.
 */
export async function runGraphWorkerPilot(options: {
  directory: string;
  command: string;
  args: string[];
  leaseWindowMs?: number;
  pollMs?: number;
  resumeFrom?: string;
  leadApproval?: string;
  onStarted?: (child: ChildProcess) => void | Promise<void>;
}): Promise<PilotResult> {
  const directory = resolve(options.directory);
  const leaseWindowMs = options.leaseWindowMs ?? 3_000;
  const pollMs = options.pollMs ?? 100;
  if (!Number.isFinite(leaseWindowMs) || !Number.isInteger(pollMs) || pollMs < 1 || pollMs > leaseWindowMs / 3) {
    throw new Error("Require 0 < pollMs <= leaseWindowMs/3");
  }
  const attemptId = randomUUID();
  let predecessor: string | undefined;
  if (options.resumeFrom) {
    if (!options.leadApproval?.trim()) throw new Error("Manual resume requires a lead approval receipt");
    predecessor = resolve(options.resumeFrom);
    const old = JSON.parse(readFileSync(join(predecessor, "state.json"), "utf8"));
    if (old.state !== "worker-stuck" || !Number.isSafeInteger(old.evidence?.pid) || old.evidence.pid <= 0
        || probeProcess(old.evidence.pid) !== "gone") {
      throw new Error("Resume requires worker-stuck and proof the previous PID is gone; unknown/alive is a collision");
    }
    if (directory === predecessor) throw new Error("Resume requires a new attempt directory");
  }
  mkdirSync(directory);
  // FNXC:GraphWorkerPilot 2026-09-13-21:27: An exclusive successor claim fences concurrent manual resumes; never overwrite it.
  if (predecessor) writeFileSync(join(predecessor, "resumed-by.json"), JSON.stringify({
    attemptId, directory, leadApproval: options.leadApproval,
  }), { flag: "wx", mode: 0o600 });
  const statePath = join(directory, "state.json");
  const abort = new AbortController();
  let stuck: WorkerStuck | undefined;
  const executor = new WorkflowGraphExecutor({
    signal: abort.signal, maxRetriesPerNode: 1,
    handlers: {
      prompt: async (node) => {
        if (node.id !== "work") throw new Error("Pilot must never automatically redispatch a dead worker");
        const managed = superviseSpawn(options.command, options.args, {
          cwd: directory, stdio: ["ignore", "pipe", "pipe"], maxLifetimeMs: 0,
        });
        const child = managed.child;
        let rejectAgent: (error: unknown) => void = () => {};
        let ioError: unknown;
        const agentExited = new Promise<{ outcome: "success" }>((resolveDone, reject) => {
          rejectAgent = reject;
          child.once("error", reject);
          child.once("exit", (code) => {
            // FNXC:GraphWorkerPilot 2026-09-13-21:42: Successful exit ends death observation before stdio close; abnormal exits still reproduce #260's lost completion.
            if (code === 0) resolveDone({ outcome: "success" });
          });
        });
        // FNXC:GraphWorkerPilot 2026-09-13-21:42: Setup may fail before the observer attaches; always consume a later spawn error.
        void agentExited.catch(() => undefined);
        const sample = { leaseRenewedAt: Date.now(), progress: 0 };
        let renew: ReturnType<typeof setInterval> | undefined;
        let monitor: ReturnType<typeof observeGraphWorker> | undefined;
        const log = (chunk: Buffer, advances: boolean) => {
          try {
            appendFileSync(join(directory, "agent.log"), chunk, { mode: 0o600 });
            if (advances) sample.progress += chunk.length;
          } catch (error) { ioError = error; rejectAgent(error); }
        };
        child.stdout!.on("data", (chunk: Buffer) => log(chunk, true));
        child.stderr!.on("data", (chunk: Buffer) => log(chunk, false));
        try {
          writeJson(statePath, { state: "running", attemptId, nodeId: node.id, pid: child.pid, predecessor });
          writeJson(join(directory, "lease.json"), sample);
          renew = setInterval(() => { sample.leaseRenewedAt = Date.now(); }, pollMs);
          monitor = observeGraphWorker({ attemptId, nodeId: node.id, child, leaseWindowMs, pollMs,
            read: () => sample,
            record: (terminal) => {
              writeJson(join(directory, "lease.json"), sample);
              writeJson(statePath, terminal);
              stuck = terminal;
              abort.abort("worker-stuck");
            },
          });
          // FNXC:GraphWorkerPilot 2026-09-13-21:48: Notification latency must not postpone successful-exit observation; only its failure competes with agent exit.
          const notification = Promise.resolve().then(() => options.onStarted?.(child));
          const notificationFailed = notification.then(() => new Promise<never>(() => {}));
          const result = await monitor.race(Promise.race([agentExited, notificationFailed]));
          if ("state" in result) return { outcome: "failure", value: "worker-stuck" };
          // FNXC:GraphWorkerPilot 2026-09-13-21:42: Clean-exit output gets one lease to drain, with observation stopped; retained pipes fail as a harness error, never worker-stuck.
          let drainTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([Promise.all([managed.waitExit(), notification]), new Promise<never>((_, reject) => {
              drainTimer = setTimeout(() => reject(new Error("Agent completion drain exceeded lease window")), leaseWindowMs);
            })]);
          } finally { if (drainTimer) clearTimeout(drainTimer); }
          if (ioError) throw ioError;
          return result;
        } catch (error) {
          // FNXC:GraphWorkerPilot 2026-09-13-21:42: The spawning harness owns error cleanup, not the observer. Reap only its captured process group; never restart or traverse recovery.
          abort.abort("pilot-error");
          monitor?.stop();
          managed.kill("SIGKILL");
          await managed.waitExit();
          throw error;
        } finally {
          if (renew) clearInterval(renew);
          monitor?.stop();
        }
      },
    },
  });
  try {
    const graph = await executor.run({ id: basename(directory), column: "in-progress", steps: [] } as unknown as TaskDetail,
      { experimentalFeatures: {} }, pilotGraph);
    const result: PilotResult = { state: stuck ? "worker-stuck" : graph.outcome === "success" ? "completed" : "failed",
      attemptId, visitedNodeIds: graph.visitedNodeIds };
    writeJson(statePath, { ...stuck, ...result, predecessor });
    return result;
  } catch (error) {
    abort.abort("pilot-error");
    throw error;
  }
}
