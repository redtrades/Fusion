import { describe, it, expect, vi, beforeEach } from "vitest";
import { HermesRuntimeAdapter } from "../runtime-adapter.js";

const { mockInvoke, mockReceipt } = vi.hoisted(() => ({
  mockReceipt: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock("../cli-spawn.js", async () => {
  const actual = await vi.importActual<typeof import("../cli-spawn.js")>(
    "../cli-spawn.js",
  );
  return {
    ...actual,
    invokeHermesCli: mockInvoke,
  };
});

vi.mock("../session-receipt.js", () => ({ readHermesSessionReceipt: mockReceipt }));

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue({
    body: "hello from hermes",
    sessionId: "20260427_120000_abc123",
  });
});

describe("HermesRuntimeAdapter — identity", () => {
  it("has stable id/name", () => {
    const adapter = new HermesRuntimeAdapter({});
    expect(adapter.id).toBe("hermes");
    expect(adapter.name).toBe("Hermes Runtime");
  });
});

describe("HermesRuntimeAdapter — createSession", () => {
  it("returns a session with empty sessionId and undefined sessionFile", async () => {
    const adapter = new HermesRuntimeAdapter({});
    const onText = vi.fn();
    const result = await adapter.createSession({
      cwd: "/repo",
      systemPrompt: "be helpful",
      onText,
    });
    expect(result.sessionFile).toBeUndefined();
    expect(result.session.sessionId).toBe("");
    expect(result.session.systemPrompt).toBe("be helpful");
    expect(result.session.callbacks.onText).toBe(onText);
  });
});

describe("HermesRuntimeAdapter — promptWithFallback", () => {
  it("invokes hermes CLI with no resume on first call", async () => {
    const adapter = new HermesRuntimeAdapter({ model: "claude-sonnet-4-5" });
    const onText = vi.fn();
    const { session } = await adapter.createSession({
      cwd: "/repo",
      systemPrompt: "sys",
      onText,
    });

    await adapter.promptWithFallback(session, "first prompt");

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [prompt, settings, resumeId] = mockInvoke.mock.calls[0];
    expect(prompt).toContain("User request:\nfirst prompt");
    expect(prompt).toContain("Fusion runtime context:");
    expect(settings.model).toBe("claude-sonnet-4-5");
    expect(resumeId).toBeUndefined();
    expect(onText).toHaveBeenCalledWith("hello from hermes");
    // Session id is captured for next call
    expect(session.sessionId).toBe("20260427_120000_abc123");
    expect(session.messages).toEqual([
      { role: "user", content: "first prompt" },
      { role: "assistant", content: "hello from hermes" },
    ]);
    expect(session.state.messages).toBe(session.messages);
    expect(session.state.errorMessage).toBeUndefined();
  });

  it("passes captured session id as --resume on subsequent calls", async () => {
    const adapter = new HermesRuntimeAdapter({});
    const { session } = await adapter.createSession({
      cwd: "/repo",
      systemPrompt: "sys",
    });
    await adapter.promptWithFallback(session, "p1");
    await adapter.promptWithFallback(session, "p2");

    const [prompt2, , resume2] = mockInvoke.mock.calls[1];
    expect(prompt2).toBe("p2");
    expect(resume2).toBe("20260427_120000_abc123");
  });

  it("propagates CLI errors", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("hermes: missing session_id"));
    const adapter = new HermesRuntimeAdapter({});
    const { session } = await adapter.createSession({
      cwd: "/repo",
      systemPrompt: "sys",
    });
    await expect(adapter.promptWithFallback(session, "p")).rejects.toThrow(
      /missing session_id/,
    );
    expect(session.messages).toEqual([]);
    expect(session.state.errorMessage).toBe("hermes: missing session_id");
  });

  it("does NOT call onText when body is empty", async () => {
    mockInvoke.mockResolvedValueOnce({
      body: "",
      sessionId: "20260427_120000_def456",
    });
    const adapter = new HermesRuntimeAdapter({});
    const onText = vi.fn();
    const { session } = await adapter.createSession({
      cwd: "/repo",
      systemPrompt: "sys",
      onText,
    });
    await adapter.promptWithFallback(session, "p");
    expect(onText).not.toHaveBeenCalled();
    expect(session.messages).toEqual([
      { role: "user", content: "p" },
      { role: "assistant", content: "" },
    ]);
    expect(session.state.errorMessage).toBeUndefined();
  });
});

describe("HermesRuntimeAdapter — describeModel", () => {
  it("returns hermes/<provider>/<model> when both set", async () => {
    const adapter = new HermesRuntimeAdapter({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
    const { session } = await adapter.createSession({
      cwd: "/repo",
      systemPrompt: "sys",
    });
    expect(adapter.describeModel(session)).toBe(
      "hermes/anthropic/claude-sonnet-4-5",
    );
  });

  it("returns hermes/<model> when only model set", async () => {
    const adapter = new HermesRuntimeAdapter({ model: "MiniMax-M2.7" });
    const { session } = await adapter.createSession({
      cwd: "/repo",
      systemPrompt: "sys",
    });
    expect(adapter.describeModel(session)).toBe("hermes/MiniMax-M2.7");
  });

  it("passes MiniMax-M3 through unchanged", async () => {
    const adapter = new HermesRuntimeAdapter({ model: "MiniMax-M3" });
    const { session } = await adapter.createSession({
      cwd: "/repo",
      systemPrompt: "sys",
    });
    expect(adapter.describeModel(session)).toBe("hermes/MiniMax-M3");
  });

  it("returns plain 'hermes' when neither set", async () => {
    const adapter = new HermesRuntimeAdapter({});
    const { session } = await adapter.createSession({
      cwd: "/repo",
      systemPrompt: "sys",
    });
    expect(adapter.describeModel(session)).toBe("hermes");
  });
});

describe("HermesRuntimeAdapter — dispose", () => {
  it("is a no-op", async () => {
    const adapter = new HermesRuntimeAdapter({});
    const { session } = await adapter.createSession({
      cwd: "/repo",
      systemPrompt: "sys",
    });
    await expect(adapter.dispose!(session)).resolves.toBeUndefined();
  });
});


describe("Hermes cancellation handoff", () => {
  it("passes the current prompt signal and does not accept cancelled output", async () => {
    const controller = new AbortController();
    mockInvoke.mockImplementationOnce((_prompt, _settings, _resume, signal) => new Promise((_resolve, reject) => {
      if (!signal) { reject(new Error("missing cancellation signal")); return; }
      signal.addEventListener("abort", () => reject(new Error("hermes: invocation aborted")), { once: true });
    }));
    const adapter = new HermesRuntimeAdapter({});
    const onText = vi.fn();
    const { session } = await adapter.createSession({ cwd: "/repo", systemPrompt: "sys", onText });
    const pending = adapter.promptWithFallback(session, "bounded task", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("invocation aborted");
    expect(onText).not.toHaveBeenCalled();
    expect(session.messages).toEqual([]);
  });
});


describe("Hermes opt-in receipt delivery", () => {
  it("does not request a receipt for existing default sessions", async () => {
    const { session } = await new HermesRuntimeAdapter({}).createSession({ cwd: "/repo", systemPrompt: "sys" });
    await new HermesRuntimeAdapter({}).promptWithFallback(session, "task");
    expect(mockReceipt).not.toHaveBeenCalled();
    expect(session.nativeReceipt).toBeUndefined();
  });
  it("awaits exact receipt before assistant delivery and passes cancellation", async () => {
    const adapter = new HermesRuntimeAdapter({ captureSessionReceipt: true, profile: "pilot" });
    const onText = vi.fn();
    const { session } = await adapter.createSession({ cwd: "/repo", systemPrompt: "sys", onText });
    const receipt = { sessionId: "20260427_120000_abc123", scope: "session-cumulative" };
    let finish!: (value: unknown) => void;
    mockReceipt.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = adapter.promptWithFallback(session, "task", { signal: controller.signal });
    await Promise.resolve();
    expect(onText).not.toHaveBeenCalled();
    expect(mockReceipt).toHaveBeenCalledWith(expect.objectContaining({ profile: "pilot" }), receipt.sessionId, controller.signal);
    finish(receipt); await pending;
    expect(session.nativeReceipt).toBe(receipt);
    expect(onText).toHaveBeenCalledOnce();
  });
  it("retains native continuity but rejects output when export fails and clears old receipts", async () => {
    const adapter = new HermesRuntimeAdapter({ captureSessionReceipt: true });
    const onText = vi.fn();
    const { session } = await adapter.createSession({ cwd: "/repo", systemPrompt: "sys", onText });
    mockReceipt.mockRejectedValueOnce(new Error("Hermes session receipt unavailable"));
    await expect(adapter.promptWithFallback(session, "task")).rejects.toThrow("receipt unavailable");
    expect(session.sessionId).toBe("20260427_120000_abc123");
    expect(session.nativeReceipt).toBeUndefined();
    expect(onText).not.toHaveBeenCalled();
  });
});
