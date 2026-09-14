import { afterEach, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, realpath, rm, symlink, writeFile, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveCodexTaskSandbox } from "../cli-agent/codex-task-sandbox.js";
const exec = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codex-git-sandbox-"))); cleanup.push(root);
  const main = join(root, "main"), task = join(root, "task");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (args: string[], cwd = main) => exec("git", args, { cwd, env, timeout: 5000 });
  await exec("git", ["init", "--initial-branch=main", main], { env, timeout: 5000 });
  await git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture"]);
  await git(["worktree", "add", "-b", "task/author", task]);
  return { root, main, task, git, common: join(main, ".git"), admin: join(main, ".git/worktrees/task") };
}
it("derives only native linked-worktree admin, objects and exact current loose ref paths", async () => {
  const f = await fixture(); const p = await deriveCodexTaskSandbox(f.task);
  expect(p.writableRoots).toEqual([f.admin, join(f.common,"objects"), join(f.common,"refs/heads/task/author"), join(f.common,"refs/heads/task/author.lock"), join(f.common,"logs/refs/heads/task/author")]);
  expect(p.ref).toBe("refs/heads/task/author");
  const alias = join(f.root,"alias"); await symlink(f.task, alias);
  expect(await deriveCodexTaskSandbox(alias)).toEqual(p);
});
it("refuses detached task worktree instead of granting another ref", async () => {
  const f = await fixture(); await f.git(["checkout", "--detach"], f.task);
  await expect(deriveCodexTaskSandbox(f.task)).rejects.toThrow();
});
it("refuses nonlinked layout instead of granting shared git directory", async () => {
  const f = await fixture(); await expect(deriveCodexTaskSandbox(f.main)).rejects.toThrow();
});
it.each(["objects", "refs/heads/task", "logs/refs/heads/task"])("refuses symlink substitution at %s", async relative => {
  const f = await fixture(); const path = join(f.common,relative); await rename(path,path+"-saved"); await symlink(path+"-saved",path);
  await expect(deriveCodexTaskSandbox(f.task)).rejects.toThrow();
});
it("refuses future ref lock symlink even when target does not exist", async () => {
  const f = await fixture(); await symlink(join(f.root,"escape-lock"),join(f.common,"refs/heads/task/author.lock"));
  await expect(deriveCodexTaskSandbox(f.task)).rejects.toThrow();
});
it("refuses mismatched linked worktree backlink", async () => {
  const f = await fixture(); await writeFile(join(f.admin,"gitdir"),join(f.root,"other/.git")+"\n");
  await expect(deriveCodexTaskSandbox(f.task)).rejects.toThrow();
});
it("does not reuse derived branch identity after actual symbolic ref changes", async () => {
  const f = await fixture(); const before = await deriveCodexTaskSandbox(f.task);
  await f.git(["checkout", "-b", "task/replaced"],f.task);
  const after = await deriveCodexTaskSandbox(f.task);
  expect(after.ref).not.toBe(before.ref); expect(after.writableRoots).not.toEqual(before.writableRoots);
});

it("refuses packed-only refs instead of widening to packed-refs.lock", async () => {
  const f = await fixture(); await f.git(["pack-refs", "--all"]);
  await expect(deriveCodexTaskSandbox(f.task)).rejects.toThrow();
});
it("refuses unsupported Git ref storage", async () => {
  const f = await fixture(); await f.git(["config", "extensions.refStorage", "reftable"]);
  await expect(deriveCodexTaskSandbox(f.task)).rejects.toThrow();
});

it("refuses directory substitution for an exact reflog file", async () => {
  const f = await fixture(); const path = join(f.common, "logs/refs/heads/task/author");
  await rename(path, path + "-saved"); await mkdir(path);
  await expect(deriveCodexTaskSandbox(f.task)).rejects.toThrow();
});
it("refuses an existing branch lock instead of sharing another writer's lock", async () => {
  const f = await fixture(); await writeFile(join(f.common, "refs/heads/task/author.lock"), "active writer");
  await expect(deriveCodexTaskSandbox(f.task)).rejects.toThrow();
});
