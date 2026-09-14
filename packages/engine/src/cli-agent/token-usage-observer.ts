import { open, realpath } from "node:fs/promises";
import { parseCliTokenUsage } from "./token-usage.js";
import type { CliSession, CliSessionStore, CliTokenUsageWrite, TaskStore } from "@fusion/core";
import type { TelemetryHub } from "./telemetry-hub.js";

export interface CliUsageProtection {
  store: Pick<TaskStore, "recordCliTokenUsageFenced">;
  sessions: Pick<CliSessionStore, "flush">;
  admission: CliTokenUsageWrite["admission"];
  limits: CliTokenUsageWrite["limits"];
  identityTimeoutMs?: number;
  pollMs?: number;
}
/** Exact authenticated native path, bounded reads, serialized durable accounting. */
export class CliTokenUsageObserver {
  private identity?: { nativeSessionId: string; transcriptPath: string };
  private offset = 0;
  private partial = Buffer.alloc(0);
  private fileIdentity?: string;
  private nativeHeaderVerified = false;
  private nativeCwd?: string;
  private sawUsageAfterBaseline = false;
  private queue: Promise<void> = Promise.resolve();
  private failure?: Error;
  private timer?: ReturnType<typeof setInterval>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly readyPromise: Promise<void>;
  private readonly unregister: () => void;
  private stopped = false;
  private polling = false;
  constructor(private readonly record: CliSession, private readonly protection: CliUsageProtection, hub: TelemetryHub, private readonly stop: (error: Error) => void) {
    this.readyPromise = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    // Prevent an early hook error becoming an unhandled rejection before launch awaits readiness.
    void this.readyPromise.catch(() => {});
    this.unregister = hub.registerNativeIdentityListener(record.id, identity => {
      if (this.identity) {
        if (this.identity.nativeSessionId !== identity.nativeSessionId) this.fail(new Error("Native usage identity changed"));
        else if (this.identity.transcriptPath !== identity.transcriptPath) this.enqueue(async () => {
          if (await realpath(this.identity!.transcriptPath) !== await realpath(identity.transcriptPath)) throw new Error("Native usage path identity changed");
        });
        return;
      }
      this.identity = identity;
      this.enqueue(async () => {
        await this.read(true, false);
        this.readyResolve();
        if (!this.stopped) this.timer = setInterval(() => {
          if (this.polling || this.stopped) return;
          this.polling = true;
          this.enqueue(async () => { try { await this.read(false, false); } finally { this.polling = false; } });
        }, protection.pollMs ?? 250);
      });
    });
  }
  private fail(error: unknown): void {
    if (this.failure) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.readyReject(this.failure);
    this.stop(this.failure);
    this.close();
  }
  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue.then(async () => { if (!this.failure) await operation(); }).catch(error => this.fail(error));
  }
  async ready(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.readyPromise, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Native usage hook identity/readiness unavailable")), this.protection.identityTimeoutMs ?? 10000); })]);
      if (this.failure) throw this.failure;
    } catch (error) { if (!this.stopped) this.fail(error); throw error; }
    finally { if (timeout) clearTimeout(timeout); }
  }
  async drain(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.enqueue(() => this.read(false, true));
    await this.queue;
    if (this.failure) throw this.failure;
  }
  close(): void { this.stopped = true; this.readyReject(new Error("Native usage observer closed")); if (this.timer) clearInterval(this.timer); this.unregister(); }
  private async read(baseline: boolean, final: boolean): Promise<void> {
    if (!this.identity) throw new Error("Native usage identity unavailable");
    const canonical = await realpath(this.identity.transcriptPath);
    const file = await open(canonical, "r");
    try {
      const stat = await file.stat();
      const identity = `${stat.dev}:${stat.ino}`;
      if (!stat.isFile() || (this.fileIdentity && identity !== this.fileIdentity) || stat.size < this.offset) throw new Error("Native usage file replaced/truncated");
      this.fileIdentity = identity;
      // Bound both each read and each drain. Larger histories fail closed, never truncate accounting.
      if (stat.size - this.offset > 16 * 1024 * 1024) throw new Error("Native usage read capacity reached");
      const observations: CliTokenUsageWrite["observations"] = [];
      while (this.offset < stat.size) {
        const buffer = Buffer.alloc(Math.min(64 * 1024, stat.size - this.offset));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, this.offset);
        if (!bytesRead) throw new Error("Native usage short read");
        this.offset += bytesRead;
        this.partial = Buffer.concat([this.partial, buffer.subarray(0, bytesRead)]);
        let newline: number;
        while ((newline = this.partial.indexOf(10)) >= 0) {
          const line = this.partial.subarray(0, newline).toString("utf8");
          this.partial = this.partial.subarray(newline + 1);
          this.parseLine(line, observations);
        }
        if (this.partial.length > 1024 * 1024) throw new Error("Native usage line capacity reached");
      }
      if (final && this.partial.length) { this.parseLine(this.partial.toString("utf8"), observations); this.partial = Buffer.alloc(0); }
      if (this.record.adapterId === "codex") {
        if (!this.nativeHeaderVerified || !this.nativeCwd || !this.record.worktreePath) throw new Error("Native usage session metadata unavailable");
        if (await realpath(this.nativeCwd) !== await realpath(this.record.worktreePath)) throw new Error("Native usage worktree identity mismatch");
      }
      if (!baseline && observations.length) this.sawUsageAfterBaseline = true;
      if (final && !this.sawUsageAfterBaseline) throw new Error("Native usage schema was not observed for this turn");
      await this.protection.sessions.flush();
      const ack = await this.protection.store.recordCliTokenUsageFenced(this.record.taskId!, {
        sessionId: this.record.id, nativeSessionId: this.identity.nativeSessionId, projectId: this.record.projectId,
        admission: this.protection.admission, observations, baseline,
        cursor: { bytes: this.offset - this.partial.length, fileIdentity: identity, phase: final ? "drained" : baseline ? "baseline" : "observing" },
        limits: this.protection.limits,
      });
      if (ack.hardExceeded) throw new Error("CLI observed token budget exceeded");
    } finally { await file.close(); }
  }
  private parseLine(line: string, observations: CliTokenUsageWrite["observations"]): void {
    if (!line.trim()) return;
    const row = JSON.parse(line) as Record<string, unknown>;
    if (this.record.adapterId === "codex" && row.type === "session_meta") {
      const payload = row.payload as Record<string, unknown>;
      if (payload?.id !== this.identity!.nativeSessionId || typeof payload.cwd !== "string") throw new Error("Native usage header identity mismatch");
      this.nativeCwd = payload.cwd;
      this.nativeHeaderVerified = true;
    }
    const observation = parseCliTokenUsage(this.record.adapterId, row);
    if (!observation) return;
    if (this.record.adapterId === "claude-code" && row.sessionId !== this.identity!.nativeSessionId) throw new Error("Native usage message session mismatch");
    observations.push(observation);
    if (observations.length > 4096) throw new Error("Native usage batch capacity reached");
  }
}
