/**
 * Hermes Runtime Adapter — drives the local `hermes` CLI as a subprocess.
 *
 * Each call to `promptWithFallback` invokes `hermes chat -q ... -Q --source tool`
 * and captures the resulting `session_id:` line. Subsequent calls on the same
 * session pass `--resume <id>` to continue the conversation.
 */

import { readHermesSessionReceipt } from "./session-receipt.js";
import { invokeHermesCli, resolveCliSettings } from "./cli-spawn.js";
import type { HermesCliSettings } from "./cli-spawn.js";
import type {
  AgentRuntime,
  AgentRuntimeOptions,
  AgentSession,
  AgentSessionResult,
  HermesStreamSession,
} from "./types.js";

interface SessionLifecycle {
  cwd: string;
  beforeSpawnSession?: () => Promise<void> | void;
  disposed: boolean;
  active?: { controller: AbortController; completion: Promise<void> };
}
const lifecycles = new WeakMap<AgentSession, SessionLifecycle>();

function buildRuntimeContextSection(options: AgentRuntimeOptions): string {
  const skillNames = Array.isArray(options.skills) ? options.skills.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
  const skillSelection = options.skillSelection as { requestedSkillNames?: unknown } | undefined;
  const selectionSkillNames = Array.isArray(skillSelection?.requestedSkillNames)
    ? skillSelection.requestedSkillNames.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const mergedSkills = skillNames.length > 0 ? skillNames : selectionSkillNames;

  const lines: string[] = [
    "Fusion runtime context:",
    `- Tool mode: ${options.tools ?? "coding"}`,
  ];

  if (mergedSkills.length > 0) {
    lines.push(`- Requested skills: ${mergedSkills.join(", ")}`);
  }

  lines.push("- If fn_* tools are available in your runtime, use them directly for coordination/memory/task actions.");

  return lines.join("\n");
}

export class HermesRuntimeAdapter implements AgentRuntime {
  readonly id = "hermes";
  readonly name = "Hermes Runtime";

  private readonly settings: HermesCliSettings;

  constructor(settings?: Record<string, unknown> | HermesCliSettings) {
    this.settings = resolveCliSettings(
      settings as Record<string, unknown> | undefined,
    );
  }

  async createSession(options: AgentRuntimeOptions): Promise<AgentSessionResult> {
    const messages: unknown[] = [];
    const session: HermesStreamSession = {
      model: undefined,
      systemPrompt: options.systemPrompt,
      messages,
      state: { messages },
      apiKey: undefined,
      thinkingLevel: undefined,
      sessionId: "",
      lastModelDescription: this.describeFromSettings(),
      callbacks: {
        onText: options.onText,
        onThinking: options.onThinking,
        onToolStart: options.onToolStart,
        onToolEnd: options.onToolEnd,
      },
      runtimeContext: options.runtimeContext,
      fusedSystemPrompt: [options.systemPrompt.trim(), buildRuntimeContextSection(options).trim()].filter((part) => part.length > 0).join("\n\n"),
      dispose: () => this.dispose(session),
    };

    lifecycles.set(session, { cwd: options.cwd, beforeSpawnSession: options.beforeSpawnSession, disposed: false });
    return { session, sessionFile: undefined };
  }

  async promptWithFallback(
    session: AgentSession,
    prompt: string,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    const lifecycle = lifecycles.get(session);
    if (!lifecycle || lifecycle.disposed) throw new Error("hermes: session disposed");
    if (lifecycle.active) throw new Error("hermes: session already has an active prompt");
    const controller = new AbortController();
    const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    if (signal.aborted) throw new Error("hermes: invocation aborted");
    const completion = this.runPrompt(session, prompt, signal, lifecycle);
    lifecycle.active = { controller, completion };
    try { await completion; }
    finally { if (lifecycle.active?.completion === completion) lifecycle.active = undefined; }
  }

  private async runPrompt(session: AgentSession, prompt: string, signal: AbortSignal, lifecycle: SessionLifecycle): Promise<void> {
    if (signal.aborted) throw new Error("hermes: invocation aborted");
    session.nativeReceipt = undefined;
    const resumeId = session.sessionId || undefined;
    const promptWithContext = resumeId
      ? prompt
      : `${session.fusedSystemPrompt}\n\nUser request:\n${prompt}`;
    const userMessage = { role: "user", content: prompt };
    session.messages.push(userMessage);
    let result: Awaited<ReturnType<typeof invokeHermesCli>>;
    try {
      result = await invokeHermesCli(promptWithContext, this.settings, resumeId, signal, { cwd: lifecycle.cwd, beforeSpawnSession: lifecycle.beforeSpawnSession });
      // Preserve native continuity even if the post-turn export fails.
      session.sessionId = result.sessionId;
      if (this.settings.captureSessionReceipt) {
        const receipt = await readHermesSessionReceipt(this.settings, result.sessionId, signal);
        if (signal.aborted) throw new Error("hermes: invocation aborted");
        session.nativeReceipt = receipt;
      }
      if (signal?.aborted) throw new Error("hermes: invocation aborted");
      session.state.errorMessage = undefined;
    } catch (err) {
      if (signal.aborted) session.nativeReceipt = undefined;
      session.messages.pop();
      session.state.errorMessage = err instanceof Error ? err.message : String(err);
      throw err;
    }

    session.sessionId = result.sessionId;
    session.lastModelDescription = this.describeFromSettings();

    session.messages.push({ role: "assistant", content: result.body });
    if (result.body) {
      session.callbacks.onText?.(result.body);
    }
  }

  describeModel(session: AgentSession): string {
    return session.lastModelDescription || this.describeFromSettings();
  }

  /** FNXC:HermesLifecycle 2026-09-14-08:25: Disposal owns only this session's pending prompt; await supervised child close before returning. */
  async dispose(session: AgentSession): Promise<void> {
    const lifecycle = lifecycles.get(session);
    if (!lifecycle) return;
    lifecycle.disposed = true;
    const active = lifecycle.active;
    active?.controller.abort();
    await active?.completion.catch(() => {});
  }

  private describeFromSettings(): string {
    const provider = this.settings.provider;
    const model = this.settings.model;
    if (provider && model) return `hermes/${provider}/${model}`;
    if (model) return `hermes/${model}`;
    if (provider) return `hermes/${provider}`;
    return "hermes";
  }
}
