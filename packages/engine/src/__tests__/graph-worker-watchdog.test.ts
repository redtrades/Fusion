import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeGraphWorker } from "../pilot/graph-worker-watchdog.js";

const pending = () => new Promise<never>(() => {});
function fixture() {
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null }) as ChildProcess;
  const snapshot = { leaseRenewedAt: 1_000, progress: 0 };
  const records: unknown[] = [];
  const monitor = observeGraphWorker({
    attemptId: "attempt-1", nodeId: "work", child, leaseWindowMs: 300, pollMs: 100,
    read: () => snapshot, record: (record) => { records.push(record); },
    probe: () => "alive",
  });
  return { child, snapshot, records, monitor };
}

afterEach(() => vi.useRealTimers());
describe("graph worker observer", () => {
  it("terminalizes a dead agent despite a renewing lease and never restarts it", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const f = fixture();
    const result = f.monitor.race(pending());
    f.child.emit("exit", null, "SIGKILL");
    f.snapshot.leaseRenewedAt = 1_050;
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ state: "worker-stuck", attemptId: "attempt-1", evidence: {
      pid: 123, process: "gone", leaseAgeMs: 50, leaseFresh: true, progress: 0, progressAgeMs: 100,
    } });
    expect(f.monitor.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.records).toHaveLength(1);
  });

  it("does not diagnose a live, slow worker from lack of progress", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const f = fixture();
    await vi.advanceTimersByTimeAsync(900);
    expect(f.records).toEqual([]);
    f.monitor.stop();
  });

  it("allows final progress one observation to settle before declaring death", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const f = fixture();
    const result = f.monitor.race(pending());
    f.child.emit("exit", 1, null);
    f.snapshot.progress = 1;
    await vi.advanceTimersByTimeAsync(100);
    expect(f.records).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ state: "worker-stuck", evidence: { progress: 1, progressAgeMs: 100 } });
  });

  it("stops observing a completed graph even when its agent exits", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const f = fixture();
    expect(await f.monitor.race(Promise.resolve("done"))).toBe("done");
    f.child.emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(600);
    expect(f.records).toEqual([]);
  });

  it("surfaces persistence failure and aborts instead of claiming durable worker-stuck", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: 1, signalCode: null }) as ChildProcess;
    const monitor = observeGraphWorker({ attemptId: "a", nodeId: "n", child, leaseWindowMs: 300, pollMs: 100,
      read: () => ({ leaseRenewedAt: 1_000, progress: 0 }), probe: () => "gone",
      record: () => { throw new Error("disk full"); } });
    const assertion = expect(monitor.race(pending())).rejects.toThrow("disk full");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(monitor.signal.aborted).toBe(true);
  });
});

describe("observer evidence boundaries", () => {
  it.each(["alive", "unknown"] as const)("does not confuse %s PID status with proven death", async (status) => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null }) as ChildProcess;
    const records: WorkerRecord[] = [];
    const monitor = observeGraphWorker({ attemptId: "a", nodeId: "n", child, leaseWindowMs: 300, pollMs: 100,
      read: () => ({ leaseRenewedAt: 1_000, progress: 0 }), probe: () => status,
      record: (record) => { records.push(record); } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(records).toEqual([]);
    monitor.stop();
  });

  it("detects ESRCH even when the child exit event is lost, including an expired lease", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null }) as ChildProcess;
    const monitor = observeGraphWorker({ attemptId: "a", nodeId: "n", child, leaseWindowMs: 300, pollMs: 100,
      read: () => ({ leaseRenewedAt: 0, progress: 0 }), probe: () => "gone", record: () => {} });
    const result = monitor.race(pending());
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ state: "worker-stuck", evidence: { leaseFresh: false } });
  });

  it("rejects a regressing progress marker instead of treating it as healthy", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const f = fixture();
    f.snapshot.progress = -1;
    const assertion = expect(f.monitor.race(pending())).rejects.toThrow("non-monotonic");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("refuses a poll interval that cannot meet the lease-window bound", () => {
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null }) as ChildProcess;
    expect(() => observeGraphWorker({ attemptId: "a", nodeId: "n", child, leaseWindowMs: 300, pollMs: 301,
      read: () => ({ leaseRenewedAt: Date.now(), progress: 0 }), record: () => {} })).toThrow("poll <= lease/3");
  });
});
type WorkerRecord = Parameters<Parameters<typeof observeGraphWorker>[0]["record"]>[0];
