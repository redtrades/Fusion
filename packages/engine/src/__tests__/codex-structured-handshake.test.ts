import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, realpath, writeFile, chmod, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAppServerSession } from "../cli-agent/codex-app-server-session.js";
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    if (!String(args[0]).endsWith("/peer.cjs")) throw new Error("Test requires an explicit synthetic peer");
    return actual.spawn(...args);
  } };
});
const releases: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const release of releases.splice(0).reverse()) await release(); });
const id = "01a09e41-4fbc-73f3-96db-73cd2e58a8e2";
async function peer(mode = "ok", sandbox = false) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "codex-rpc-test-")));
  releases.push(() => rm(cwd, { recursive: true, force: true }));
  const alias = join(cwd, "alias"); await symlink(cwd, alias);
  const escape = join(cwd, "escape"); await symlink(tmpdir(), escape);
  const requestPath = join(cwd, "requests.jsonl");
  const policy: any = { runtimeWorkspaceRoots: [alias], sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }, activePermissionProfile: null };
  if (mode === "wrong-cwd") policy.cwd = "/private/tmp";
  if (mode === "missing-policy") delete policy.sandbox;
  if (mode === "symlink-escape") policy.sandbox.writableRoots = [escape];
  if (mode === "missing-writes") delete policy.sandbox.writableRoots;
  if (mode === "widened") policy.sandbox.writableRoots = ["/private/tmp"];
  if (mode === "same-root") policy.sandbox.writableRoots = [alias];
  if (mode === "wrong-runtime") policy.runtimeWorkspaceRoots = ["/private/tmp"];
  if (mode === "missing-runtime") delete policy.runtimeWorkspaceRoots;
  if (mode === "profile") policy.activePermissionProfile = { id: "unknown" };
  if (mode === "missing-profile") delete policy.activePermissionProfile;
  if (["dangerFullAccess", "readOnly", "externalSandbox"].includes(mode)) policy.sandbox.type = mode;
  if (["excludeTmpdirEnvVar", "excludeSlashTmp"].includes(mode)) policy.sandbox[mode] = false;
  if (mode === "missing-tmp") delete policy.sandbox.excludeSlashTmp;
  if (mode === "network") policy.sandbox.networkAccess = true;
  const script = join(cwd, "peer.cjs");
  await writeFile(script, `#!${process.execPath}
if(process.argv.includes("--version")){ console.log(${JSON.stringify(mode === "bad-version" ? "codex-cli 0.155.0" : "codex-cli 0.154.0")}); process.exit(0); }
const rl=require('node:readline').createInterface({input:process.stdin});
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
rl.on('line',s=>{const q=JSON.parse(s); require('node:fs').appendFileSync(${JSON.stringify(requestPath)},JSON.stringify(q)+'\\n'); if(!q.id)return;
if(q.method==='initialize'&&${JSON.stringify(mode)}==='timeout')return;
if(q.method==='initialize')return send({id:q.id,result:{}});
if(q.method==='thread/start')return send({id:q.id,result:{...${JSON.stringify(policy)},model:${JSON.stringify(mode === 'bad-model' ? 'other' : 'chosen')},modelProvider:'openai',cwd:${JSON.stringify(mode === "wrong-cwd" ? "/private/tmp" : cwd)},thread:{id:${JSON.stringify(id)},sessionId:${JSON.stringify(mode === "divergent" ? "different" : id)},cwd:${JSON.stringify(cwd)},path:${mode === "null-path" ? "null" : JSON.stringify(join(cwd, "future.jsonl"))},ephemeral:false}}});
if(q.method==='turn/start'){ send({id:q.id,result:{turn:{id:'turn-1'}}}); ${mode === "approval" ? "send({id:500,method:'item/commandExecution/requestApproval',params:{}});" : `send({method:'turn/completed',params:{threadId:${JSON.stringify(id)},turn:{id:'turn-1',status:'completed'}}});`} }
});`);
  await chmod(script, 0o700);
  let admitted = false;
  const session = new CodexAppServerSession({ command: script, args: [], cwd: alias, ...(sandbox ? { codexSandbox: "task-worktree-write" as const } : {}), sessionsRoot: cwd, env: { PATH: process.env.PATH }, model: "chosen", onIdentity: async () => { admitted = true; }, timeoutMs: 1000 });
  releases.push(() => session.kill());
  return { session, admitted: () => admitted, cwd, requests: async () => (await readFile(requestPath, "utf8")).trim().split("\n").map(line => JSON.parse(line)) };
}
it("uses the native same-response future path before admitting a turn and correlates completion", async () => {
  const f = await peer();
  await f.session.ready();
  expect(f.admitted()).toBe(true);
  expect(f.session.identity).toMatchObject({ nativeSessionId: id, transcriptPath: join(f.cwd, "future.jsonl"), selectedModel: "chosen", selectedProvider: "openai" });
  await expect(f.session.turn("synthetic fixture only")).resolves.toBeUndefined();
});
it.each(["divergent", "null-path", "bad-version", "bad-model", "timeout"])("fails before request for unsupported identity/path: %s", async mode => {
  const f = await peer(mode);
  await expect(f.session.ready()).rejects.toThrow();
  expect(f.admitted()).toBe(false);
  await expect(f.session.turn("never sent")).rejects.toThrow();
});
it("does not autoapprove native server requests", async () => {
  const f = await peer("approval"); await f.session.ready();
  await expect(f.session.turn("synthetic fixture only")).rejects.toThrow(/approval|request/i);
});
it("kill before readiness cannot dispatch later", async () => {
  const f = await peer(); f.session.kill();
  await expect(f.session.turn("never sent")).rejects.toThrow();
});

it("requests canonical task-only writes and verifies the policy before native identity", async () => {
  const f = await peer("same-root", true); await f.session.ready();
  const request = (await f.requests()).find(q => q.method === "thread/start");
  expect(request.params).toEqual({ cwd: f.cwd, model: "chosen", ephemeral: false, allowProviderModelFallback: false,
    sandbox: "workspace-write", runtimeWorkspaceRoots: [f.cwd], config: {
      "sandbox_workspace_write.writable_roots": [], "sandbox_workspace_write.network_access": false,
      "sandbox_workspace_write.exclude_tmpdir_env_var": true, "sandbox_workspace_write.exclude_slash_tmp": true,
    } });
  expect(f.admitted()).toBe(true);
  await f.session.turn("synthetic fixture only");
});
it.each(["symlink-escape", "missing-writes", "wrong-cwd", "missing-policy", "widened", "wrong-runtime", "missing-runtime", "profile", "missing-profile", "dangerFullAccess", "readOnly", "externalSandbox", "excludeTmpdirEnvVar", "excludeSlashTmp", "missing-tmp", "network"])("refuses unsafe author policy before identity and prompt: %s", async mode => {
  const f = await peer(mode, true);
  await expect(f.session.ready()).rejects.toThrow();
  expect(f.admitted()).toBe(false);
  await expect(f.session.turn("never sent")).rejects.toThrow();
  await f.session.exited;
  expect((await f.requests()).some(q => q.method === "turn/start")).toBe(false);
});

it("cancels selected policy startup before identity and prompt and reaps its child", async () => {
  const f = await peer("ok", true); f.session.kill();
  await expect(f.session.turn("never sent")).rejects.toThrow();
  await f.session.exited; expect(f.admitted()).toBe(false);
});
it("unselected launch does not add sandbox overrides", async () => {
  const f = await peer(); await f.session.ready();
  const q = (await f.requests()).find(q => q.method === "thread/start");
  expect(q.params).not.toHaveProperty("sandbox"); expect(q.params).not.toHaveProperty("config");
});
