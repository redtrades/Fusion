/** Stable reviewed native hook command. Session credentials stay in the private context file. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
export async function forwardNativeHook(): Promise<void> {
  const path = process.env.FUSION_CLI_HOOK_CONTEXT;
  if (!path) return; // Installed native hook is inert outside a Fusion child.
  const context = JSON.parse(await readFile(path, "utf8")) as { endpoint: string; sessionId: string; token: string };
  let raw = process.argv[2];
  if (!raw) { const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of process.stdin) { const buffer = Buffer.from(chunk); bytes += buffer.length; if (bytes > 256 * 1024) throw new Error("Hook payload too large"); chunks.push(buffer); } raw = Buffer.concat(chunks).toString("utf8"); }
  const body = JSON.parse(raw ?? "{}") as Record<string, unknown>;
  const event = body.type === "agent-turn-complete" ? "notify" : typeof body.hook_event_name === "string" ? body.hook_event_name : "";
  const endpoint = new URL(context.endpoint);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) throw new Error("Native hook endpoint is not local");
  endpoint.searchParams.set("event", event);
  await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Fusion-Cli-Session-Token": context.token, "X-Fusion-Cli-Session-Id": context.sessionId }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await forwardNativeHook().catch(() => {});
