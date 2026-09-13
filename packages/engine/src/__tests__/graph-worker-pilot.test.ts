import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { runGraphWorkerPilot } from "../pilot/graph-worker-pilot.js";

/** Removing the observer or allowing graph failure traversal leaves this real killed-child run hanging. */
describe("pilot graph process-death acceptance", () => {
  it("kills only its disposable agent, persists worker-stuck within the lease, then manually resumes", async () => {
    const root = mkdtempSync(join(tmpdir(), "fusion-ws111-"));
    let killedAt = 0;
    try {
      const first = join(root, "attempt-1");
      const result = await runGraphWorkerPilot({
        directory: first, command: process.execPath,
        args: ["-e", "console.log('step 1'); setInterval(() => {}, 1000)"],
        leaseWindowMs: 1_000, pollMs: 50,
        onStarted: async (child) => {
          await once(child.stdout!, "data");
          killedAt = Date.now();
          child.kill("SIGKILL");
        },
      });
      expect(result.state).toBe("worker-stuck");
      const record = JSON.parse(readFileSync(join(first, "state.json"), "utf8"));
      expect(record.evidence).toMatchObject({ process: "gone", leaseFresh: true });
      expect(record.evidence.progress).toBeGreaterThan(0);
      expect(record.observedAt - killedAt).toBeLessThan(1_000);
      expect(record.visitedNodeIds).not.toContain("recover");
      expect(record.visitedNodeIds).not.toContain("end");
      expect(existsSync(join(first, "resumed-by.json"))).toBe(false);
      const preserved = readFileSync(join(first, "state.json"), "utf8");
      await expect(runGraphWorkerPilot({ directory: join(root, "unapproved"), command: process.execPath,
        args: ["-e", "process.exit(0)"], resumeFrom: first })).rejects.toThrow("lead approval");
      const resumed = await runGraphWorkerPilot({
        directory: join(root, "attempt-2"), command: process.execPath,
        args: ["-e", "console.log('step 2 complete')"], resumeFrom: first, leadApproval: "acceptance-test-operator",
      });
      expect(resumed.state).toBe("completed");
      expect(resumed.visitedNodeIds).toEqual(["start", "work"]);
      expect(readFileSync(join(root, "attempt-2", "agent.log"), "utf8")).toContain("step 2 complete");
      expect(readFileSync(join(first, "state.json"), "utf8")).toBe(preserved);
      await expect(runGraphWorkerPilot({ directory: join(root, "attempt-3"), command: process.execPath,
        args: ["-e", "process.exit(0)"], resumeFrom: first, leadApproval: "acceptance-test-operator",
      })).rejects.toThrow("EEXIST");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
