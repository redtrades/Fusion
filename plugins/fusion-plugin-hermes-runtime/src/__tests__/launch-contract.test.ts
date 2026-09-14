import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, realpath, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HermesRuntimeAdapter } from "../runtime-adapter.js";
const children = vi.hoisted(() => ({ pids: [] as number[], launchGate: undefined as Promise<void> | undefined }));
vi.mock("../windows-binary-launch.js", async original => {
  const actual = await original<typeof import("../windows-binary-launch.js")>();
  return { ...actual, resolveHermesLaunch: async (...args: Parameters<typeof actual.resolveHermesLaunch>) => {
    await children.launchGate;
    return actual.resolveHermesLaunch(...args);
  } };
});
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    if (!String(args[0]).endsWith("/harmless.cjs")) throw new Error("Explicit harmless child required");
    const child = actual.spawn(...args); if (child.pid) children.pids.push(child.pid); return child;
  } };
});
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  children.launchGate = undefined;
  for (const pid of children.pids.splice(0)) { try { process.kill(pid, "SIGKILL"); } catch {} }
  for (const release of cleanup.splice(0).reverse()) await release();
});
async function fixture(mode = "complete", beforeSpawnSession?: () => Promise<void> | void) {
  const root = await realpath(await mkdtemp(join(tmpdir(),"hermes-contract-"))); cleanup.push(() => rm(root,{recursive:true,force:true}));
  const executable = join(root,"harmless.cjs"), marker = join(root,"started.json");
  await writeFile(executable,`#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({cwd:process.cwd(),pid:process.pid}));const finish=()=>{console.log('synthetic reply\\nsession_id: 20260427_120000_abc123');process.exit(0);};${mode === "complete" ? "finish();" : mode === "ignore-term" ? "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);" : "process.on('SIGTERM',finish);setInterval(()=>{},1000);"}`);await chmod(executable,0o700);
  const adapter = new HermesRuntimeAdapter({binaryPath:executable});
  const onText = vi.fn(); const {session}=await adapter.createSession({cwd:root,systemPrompt:"synthetic",onText,beforeSpawnSession} as any);
  return {root,marker,adapter,session,onText};
}
it("preserves supplied cwd and awaits the callback exactly once before child execution",async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const before=vi.fn(()=>gate);
  const f=await fixture("complete",before);const pending=f.adapter.promptWithFallback(f.session,"synthetic only");
  await vi.waitFor(()=>expect(before).toHaveBeenCalledOnce()); await expect(readFile(f.marker)).rejects.toThrow();
  release();await pending;expect(JSON.parse(await readFile(f.marker,"utf8")).cwd).toBe(f.root);expect(before).toHaveBeenCalledOnce();
});
it("callback refusal produces zero native child",async()=>{
  const f=await fixture("complete",()=>{throw new Error("host refusal");});
  await expect(f.adapter.promptWithFallback(f.session,"never dispatch")).rejects.toThrow("host refusal");
  expect(children.pids).toEqual([]);await expect(readFile(f.marker)).rejects.toThrow();
});
it("abort during awaited callback cannot later spawn",async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const before=vi.fn(()=>gate);const f=await fixture("complete",before);const ac=new AbortController();
  const pending=f.adapter.promptWithFallback(f.session,"never dispatch",{signal:ac.signal});const rejected=expect(pending).rejects.toThrow(/aborted/);
  await vi.waitFor(()=>expect(before).toHaveBeenCalledOnce());ac.abort();release();await rejected;expect(children.pids).toEqual([]);
});
it("session disposal reaps only its own child and rejects late successful output",async()=>{
  const a=await fixture("wait"),b=await fixture("wait");
  const pa=a.adapter.promptWithFallback(a.session,"synthetic only"),pb=b.adapter.promptWithFallback(b.session,"synthetic only");
  const rejectedA=expect(pa).rejects.toThrow(/aborted/),rejectedB=expect(pb).rejects.toThrow(/aborted/);
  await vi.waitFor(async()=>{expect(JSON.parse(await readFile(a.marker,"utf8")).pid).toBeTruthy();expect(JSON.parse(await readFile(b.marker,"utf8")).pid).toBeTruthy();});
  const apid=JSON.parse(await readFile(a.marker,"utf8")).pid,bpid=JSON.parse(await readFile(b.marker,"utf8")).pid;
  await a.session.dispose();await rejectedA;expect(()=>process.kill(apid,0)).toThrow();expect(()=>process.kill(bpid,0)).not.toThrow();
  expect(a.onText).not.toHaveBeenCalled();expect(a.session.nativeReceipt).toBeUndefined();expect(a.session.state.errorMessage).toMatch(/aborted/);
  await b.adapter.dispose(b.session);await rejectedB;expect(()=>process.kill(bpid,0)).toThrow();
});

it("runs the spawn callback only after asynchronous launch resolution",async()=>{
  let release!:()=>void;children.launchGate=new Promise<void>(resolve=>{release=resolve;});
  const before=vi.fn();const f=await fixture("complete",before);
  const pending=f.adapter.promptWithFallback(f.session,"synthetic only");
  await Promise.resolve();expect(before).not.toHaveBeenCalled();expect(children.pids).toEqual([]);
  release();await pending;expect(before).toHaveBeenCalledOnce();
});
it("disposal aborts a pending callback without waiting for that callback to resolve",async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const before=vi.fn(()=>gate);const f=await fixture("complete",before);
  const pending=f.adapter.promptWithFallback(f.session,"never dispatch");const rejected=expect(pending).rejects.toThrow(/aborted/);
  await vi.waitFor(()=>expect(before).toHaveBeenCalledOnce());await f.adapter.dispose(f.session);await rejected;
  release();await Promise.resolve();expect(children.pids).toEqual([]);await expect(readFile(f.marker)).rejects.toThrow();
  await expect(f.adapter.promptWithFallback(f.session,"disposed session")).rejects.toThrow(/disposed/);
});

it("disposal escalates for an owned child that ignores SIGTERM and rejects overlapping prompts", async () => {
  const f = await fixture("ignore-term");
  const pending = f.adapter.promptWithFallback(f.session, "synthetic only");
  const rejected = expect(pending).rejects.toThrow(/aborted/);
  await vi.waitFor(async () => expect(JSON.parse(await readFile(f.marker, "utf8")).pid).toBeTruthy());
  const pid = JSON.parse(await readFile(f.marker, "utf8")).pid;
  await expect(f.adapter.promptWithFallback(f.session, "overlap")).rejects.toThrow(/active prompt/);
  expect(children.pids).toEqual([pid]);
  await f.session.dispose();
  await rejected;
  expect(() => process.kill(pid, 0)).toThrow();
  expect(f.onText).not.toHaveBeenCalled();
}, 5_000);
