import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
const exec = promisify(execFile);
/** Local Git fixture only: no hooks, signing, remotes or inherited Git configuration. */
export async function createCodexSandboxRepo(root: string): Promise<{ task: string; roots: string[] }> {
  const main = join(root, "main"), task = join(root, "task");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  await exec("git", ["init", "--initial-branch=main", main], { env, timeout: 5000 });
  await exec("git", ["-C", main, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture"], { env, timeout: 5000 });
  await exec("git", ["-C", main, "worktree", "add", "-b", "task/author", task], { env, timeout: 5000 });
  const common = join(main, ".git");
  return { task, roots: [join(common, "worktrees/task"), join(common, "objects"), join(common, "refs/heads/task/author"), join(common, "refs/heads/task/author.lock"), join(common, "logs/refs/heads/task/author")] };
}
