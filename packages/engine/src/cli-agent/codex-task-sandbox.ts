import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolveGitBinary } from "@fusion/core";
import { canonicalFuturePath } from "./token-usage-observer.js";

const exec = promisify(execFile);
export interface CodexTaskSandbox {
  cwd: string;
  ref: string;
  head: string;
  writableRoots: string[];
  pathIdentity: string[];
}
/**
 * FNXC:AuthorGitSandbox 2026-09-14-08:04: Ordinary author commits need linked
 * worktree bookkeeping, shared objects and only the current loose ref files.
 * Never grant shared .git/refs parents or accept caller-supplied roots. Objects
 * are writable shared data, not an append-only integrity boundary.
 */
export async function deriveCodexTaskSandbox(worktree: string): Promise<CodexTaskSandbox> {
  const cwd = await realpath(worktree), binary = await resolveGitBinary();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const git = async (args: string[]) => (await exec(binary, ["-C", cwd, ...args], { env, timeout: 5000, maxBuffer: 16384 })).stdout.trim();
  const [top, admin, commonRaw, ref, head] = await Promise.all([
    git(["rev-parse", "--show-toplevel"]), git(["rev-parse", "--absolute-git-dir"]),
    git(["rev-parse", "--git-common-dir"]), git(["symbolic-ref", "--quiet", "HEAD"]), git(["rev-parse", "--verify", "HEAD"]),
  ]);
  const common = resolve(cwd, commonRaw);
  if (top !== cwd || !isAbsolute(admin) || admin === common || dirname(dirname(admin)) !== common
    || dirname(admin) !== join(common, "worktrees") || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(head)
    || !/^refs\/heads\/[A-Za-z0-9_-][A-Za-z0-9._/-]*$/.test(ref)
    || ref.split("/").some(part => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock")) || ref.includes("..")) {
    throw new Error("Unsupported native linked Git sandbox layout");
  }
  try {
    const format = await git(["config", "--get", "extensions.refStorage"]);
    if (format !== "files") throw new Error("Unsupported native Git ref storage");
  } catch (error) { if ((error as { code?: unknown }).code !== 1) throw error; }
  const pathIdentity: string[] = [];
  const checkPath = async (path: string, future = false): Promise<void> => {
    if (await canonicalFuturePath(path) !== path) throw new Error("Native Git sandbox symlink or escape");
    for (let cursor = path; ; cursor = dirname(cursor)) {
      try {
        const value = await lstat(cursor);
        if (value.isSymbolicLink()) throw new Error("Native Git sandbox symlink substitution");
        pathIdentity.push(`${cursor}:${value.dev}:${value.ino}`);
      } catch (error) { if (!future || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (dirname(cursor) === cursor) break;
    }
  };
  for (const path of [join(cwd, ".git"), admin, common, join(admin, "gitdir"), join(admin, "commondir"), join(admin, "HEAD")]) await checkPath(path);
  const pointer = async (path: string) => {
    const info = await lstat(path);
    if (!info.isFile() || info.size > 4096) throw new Error("Unsupported native Git pointer");
    return (await readFile(path, "utf8")).trim();
  };
  const gitPointer = await pointer(join(cwd, ".git"));
  if (!gitPointer.startsWith("gitdir: ") || resolve(cwd, gitPointer.slice(8)) !== admin
    || resolve(admin, await pointer(join(admin, "commondir"))) !== common
    || resolve(admin, await pointer(join(admin, "gitdir"))) !== join(cwd, ".git")
    || await pointer(join(admin, "HEAD")) !== `ref: ${ref}`) throw new Error("Native Git sandbox identity mismatch");
  const writableRoots = [admin, join(common, "objects"), join(common, ref), join(common, `${ref}.lock`), join(common, "logs", ref)];
  for (const [index, path] of writableRoots.entries()) {
    await checkPath(path, index === 3);
    try {
      const value = await lstat(path);
      if (index === 3 || (index < 2 ? !value.isDirectory() : !value.isFile())) throw new Error("Unsupported native Git sandbox path type or active lock");
    } catch (error) { if (index !== 3 || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return { cwd, ref, head, writableRoots, pathIdentity };
}
