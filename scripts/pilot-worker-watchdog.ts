import { runGraphWorkerPilot } from "../packages/engine/src/pilot/graph-worker-pilot.js";

/** FNXC:GraphWorkerPilot 2026-09-13-21:27: Manual-only pilot entrypoint; nonzero worker-stuck status surfaces to the lead. */
const args = process.argv.slice(2);
const separator = args.indexOf("--");
const directory = args[0];
const command = separator >= 1 ? args[separator + 1] : undefined;
const flags = args.slice(1, separator);
if (!directory || !command || (flags.length !== 0 && (flags.length !== 4 || flags[0] !== "--resume-from" || flags[2] !== "--lead-approval"))) {
  console.error("Usage: pnpm exec tsx --conditions=source scripts/pilot-worker-watchdog.ts NEW_DIR [--resume-from OLD_DIR --lead-approval RECEIPT] -- COMMAND [ARGS...]");
  process.exitCode = 1;
} else {
  try {
    const result = await runGraphWorkerPilot({ directory, command, args: args.slice(separator + 2),
      resumeFrom: flags[1], leadApproval: flags[3],
      onStarted: (child) => { console.log(JSON.stringify({ state: "running", agentPid: child.pid, directory })); },
    });
    console.log(JSON.stringify(result));
    process.exitCode = result.state === "worker-stuck" ? 2 : result.state === "completed" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
