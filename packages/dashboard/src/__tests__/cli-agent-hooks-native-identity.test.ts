import { describe, expect, it, vi } from "vitest";
import { normalizeHookEvent, registerCliAgentHooksRoute } from "../routes/cli-agent-hooks.js";

describe("authenticated native CLI identity transport", () => {
  it("normalizes Codex completion without changing unrelated notify semantics", () => {
    expect(normalizeHookEvent("notify", { type: "agent-turn-complete", "thread-id": "native" })).toEqual({ kind: "done", payload: { nativeSessionId: "native" } });
    expect(normalizeHookEvent("notify", { notification_type: "permission" }).kind).toBe("waitingOnInput");
    expect(normalizeHookEvent(undefined, { hook_event_name: "SessionStart", session_id: "native", transcript_path: "/private/native.jsonl" })).toEqual({ kind: "sessionStart", payload: { nativeSessionId: "native" } });
  });
  it("forwards private identity only after exact session token validation", () => {
    let handler: any;
    const hub = { validateToken: vi.fn(() => false), ingest: vi.fn(), ingestNativeSessionStart: vi.fn() };
    registerCliAgentHooksRoute({ router: { post: (_path: string, _parser: unknown, fn: unknown) => { handler = fn; } }, runtimeLogger: { child: () => ({ warn: vi.fn() }) }, getProjectIdFromRequest: () => "project", options: { cliAgentHubResolver: () => hub } } as any);
    const req = { headers: { host: "127.0.0.1", "x-fusion-cli-session-id": "record", "x-fusion-cli-session-token": "token" }, query: {}, body: { hook_event_name: "SessionStart", session_id: "native", transcript_path: "/private/native.jsonl" } };
    const response = { status: vi.fn(), json: vi.fn() }; response.status.mockReturnValue(response);
    handler(req, response);
    expect(hub.ingestNativeSessionStart).not.toHaveBeenCalled();
    hub.validateToken.mockReturnValue(true); handler(req, response);
    expect(hub.ingestNativeSessionStart).toHaveBeenCalledWith("record", { nativeSessionId: "native", transcriptPath: "/private/native.jsonl" });
    expect(hub.ingest).toHaveBeenCalledWith("record", { kind: "sessionStart", payload: { nativeSessionId: "native" } });
  });
});
