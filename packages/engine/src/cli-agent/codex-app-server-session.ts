import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { superviseSpawn } from "@fusion/core";
import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { canonicalFuturePath } from "./token-usage-observer.js";
import { StringDecoder } from "node:string_decoder";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Codex RPC object");
  return value as Record<string, unknown>;
};
export interface CodexNativeIdentity { nativeSessionId: string; transcriptPath: string }
export interface CodexAppServerOptions {
  command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  model?: string; modelProvider?: string; timeoutMs?: number;
  /** Test fixtures may select their isolated session root explicitly. */
  sessionsRoot?: string;
  onIdentity: (identity: CodexNativeIdentity) => Promise<void>;
  onOutput?: (text: string) => void;
  onExit?: () => void;
}
/**
 * FNXC:CodexHandshake 2026-09-14-05:15: Codex 0.154 stdio RPC is a distinct
 * native transport, never a PTY. Admission acknowledges exact root-thread ID
 * and native future path before turn/start. No approval decision is inferred.
 * Protocol: https://learn.chatgpt.com/docs/app-server (rust-v0.154.0).
 */
export class CodexAppServerSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly process: ReturnType<typeof superviseSpawn>;
  private versionProcess?: ReturnType<typeof superviseSpawn>;
  private readonly startup: Promise<void>;
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private sequence = 0;
  private failure?: Error;
  private turnActive = false;
  private dispatched = false;
  private turnId?: string;
  private completion?: { id: string; status: string };
  private complete?: { resolve: () => void; reject: (error: Error) => void };
  private nativeIdentity?: CodexNativeIdentity;
  get identity(): CodexNativeIdentity | undefined { return this.nativeIdentity && { ...this.nativeIdentity }; }
  get pid(): number | undefined { return this.child.pid; }
  readonly exited: Promise<{ exitCode: number; signal: number | undefined }>;

  constructor(private readonly options: CodexAppServerOptions) {
    this.process = superviseSpawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: "pipe", maxLifetimeMs: 0 });
    this.child = this.process.child as ChildProcessWithoutNullStreams;
    const decoder = new StringDecoder("utf8"); let buffer = "";
    this.child.stdout.on("data", (bytes: Buffer) => {
      try {
        buffer += decoder.write(bytes);
        if (Buffer.byteLength(buffer) > 1024 * 1024) throw new Error("Codex RPC frame capacity reached");
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (line.trim()) this.receive(JSON.parse(line));
        }
      } catch (error) { this.fail(error); }
    });
    // Drain stderr without exposing account/config diagnostics or blocking the child.
    this.child.stderr.on("data", () => {});
    this.child.on("error", error => this.fail(error));
    this.child.stdin.on("error", error => this.fail(error));
    this.exited = new Promise(resolve => this.child.once("close", (code, signal) => {
      this.fail(new Error("Codex native transport exited"));
      resolve({ exitCode: code ?? -1, signal: signal ? 9 : undefined });
      options.onExit?.();
    }));
    this.startup = this.start(); void this.startup.catch(error => this.fail(error));
  }
  ready(): Promise<void> { return this.startup; }
  private async start(): Promise<void> {
    await this.verifyVersion();

    await this.request("initialize", { clientInfo: { name: "fusion_native_codex", version: "1" }, capabilities: { experimentalApi: true } });
    this.send({ method: "initialized", params: {} });
    const response = await this.request("thread/start", { cwd: this.options.cwd, ...(this.options.model ? { model: this.options.model } : {}), ...(this.options.modelProvider ? { modelProvider: this.options.modelProvider } : {}), ephemeral: false, allowProviderModelFallback: false });
    const thread = object(response.thread);
    if (typeof thread.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(thread.id) || thread.id !== thread.sessionId || thread.ephemeral !== false) throw new Error("Unsupported Codex root-thread identity");
    if (typeof thread.path !== "string" || !isAbsolute(thread.path) || thread.path.length > 4096) throw new Error("Codex native rollout path unavailable");
    if (typeof thread.cwd !== "string" || typeof response.cwd !== "string") throw new Error("Codex native cwd unavailable");
    if (await realpath(thread.cwd) !== await realpath(this.options.cwd) || await realpath(response.cwd) !== await realpath(this.options.cwd)) throw new Error("Codex native cwd mismatch");
    if (typeof response.model !== "string" || typeof response.modelProvider !== "string" || (this.options.model && response.model !== this.options.model) || (this.options.modelProvider && response.modelProvider !== this.options.modelProvider)) throw new Error("Codex selected model/provider mismatch");
    const path = await canonicalFuturePath(thread.path);
    const root = await canonicalFuturePath(this.options.sessionsRoot ?? join(this.options.env.CODEX_HOME ?? join(this.options.env.HOME ?? homedir(), ".codex"), "sessions"));
    const within = relative(root, path);
    if (!within || within.startsWith("..") || isAbsolute(within)) throw new Error("Codex rollout outside native session storage");
    this.check();
    const identity = { nativeSessionId: thread.id, transcriptPath: thread.path };
    await this.options.onIdentity({ ...identity });
    this.check(); this.nativeIdentity = identity;
  }
  async turn(text: string): Promise<void> {
    await this.ready(); this.check();
    if (this.dispatched) throw new Error("Protected Codex continuation requires a new admitted launch");
    this.dispatched = true; this.turnActive = true; this.completion = undefined; this.turnId = undefined;
    const completed = new Promise<void>((resolve, reject) => { this.complete = { resolve, reject }; });
    void completed.catch(() => {});
    try {
      const response = await this.request("turn/start", { threadId: this.nativeIdentity!.nativeSessionId, input: [{ type: "text", text, text_elements: [] }] });
      const turn = object(response.turn);
      if (typeof turn.id !== "string" || !turn.id) throw new Error("Codex native turn identity unavailable");
      this.turnId = turn.id; this.settleCompletion();
      await completed; this.check();
    } catch (error) { this.fail(error); throw error; }
    finally { this.turnActive = false; this.complete = undefined; }
  }
  private async verifyVersion(): Promise<void> {
    this.versionProcess = superviseSpawn(this.options.command, ["--version"], { cwd: this.options.cwd, env: this.options.env, stdio: "pipe", maxLifetimeMs: 2000 });
    const child = this.versionProcess.child;
    let output = "";
    child.stdout?.on("data", (bytes: Buffer) => { output += bytes.toString("utf8"); if (output.length > 256) this.fail(new Error("Codex version response too large")); });
    child.stderr?.on("data", () => {});
    child.on("error", error => this.fail(error));
    const exit = await this.versionProcess.waitExit(); this.check();
    if (exit.code !== 0 || output.trim() !== "codex-cli 0.154.0") throw new Error("Unsupported Codex structured protocol version");
  }
  private receive(value: unknown): void {
    const message = object(value);
    if (message?.method && message.id !== undefined) throw new Error(`Unsupported Codex server request (approval/input required): ${String(message.method).slice(0, 120)}`);
    if (message?.id !== undefined) {
      if (typeof message.id !== "number") throw new Error("Unexpected Codex RPC response identity");
      const entry = this.pending.get(message.id);
      if (!entry) throw new Error("Unexpected Codex RPC response identity");
      const result = message.error ? undefined : object(message.result);
      this.pending.delete(message.id); clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error("Codex native RPC request rejected")); else entry.resolve(result!);
      return;
    }
    const params = message.params && typeof message.params === "object" ? object(message.params) : {};
    if (message?.method === "turn/completed" && this.turnActive && params?.threadId === this.nativeIdentity?.nativeSessionId) {
      const turn = object(params.turn);
      if (this.completion || typeof turn.id !== "string" || typeof turn.status !== "string") throw new Error("Invalid Codex completion identity");
      this.completion = { id: turn.id, status: turn.status }; this.settleCompletion();
    }
    if (message?.method === "item/agentMessage/delta" && this.turnActive && params?.threadId === this.nativeIdentity?.nativeSessionId && typeof params.delta === "string") this.options.onOutput?.(params.delta);
  }
  private settleCompletion(): void {
    if (!this.completion || !this.turnId) return;
    if (this.completion.id !== this.turnId || this.completion.status !== "completed") { this.fail(new Error("Codex native turn did not complete successfully")); return; }
    this.complete?.resolve();
  }
  private request(method: string, params: unknown): Promise<Record<string, unknown>> {
    this.check(); const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("Codex native RPC request timed out")), this.options.timeoutMs ?? 10000);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  private send(message: unknown): void { this.check(); this.child.stdin.write(JSON.stringify(message) + "\n"); }
  private check(): void { if (this.failure) throw this.failure; }
  private fail(error: unknown): void {
    if (this.failure) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(this.failure); }
    this.pending.clear(); this.complete?.reject(this.failure);
    this.process.kill("SIGKILL"); this.versionProcess?.kill("SIGKILL");
  }
  kill(): void {
    // Queue the supported interrupt before scoped teardown, without waiting on
    // an unresponsive peer or allowing a cancelled admission to dispatch later.
    if (!this.failure && this.turnId && this.nativeIdentity) this.child.stdin.write(JSON.stringify({ id: ++this.sequence, method: "turn/interrupt", params: { threadId: this.nativeIdentity.nativeSessionId, turnId: this.turnId } }) + "\n");
    this.fail(new Error("Codex native session cancelled"));
  }
}
