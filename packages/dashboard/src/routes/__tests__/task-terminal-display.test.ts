import { describe, expect, it } from "vitest";
import type { Task, TaskStore } from "@fusion/core";
import { enrichTaskTerminalDisplays } from "../task-terminal-display.js";

const held = { id: "T1", column: "in-review", status: "paused", paused: true, updatedAt: "2026-09-14T00:00:00Z" } as Task;
function reader(task = held, reason = "missing-input", actor = "orchestrator") {
  return { readWorkflowOverlayCurrentTerminal: async () => ({ current: true, task,
    terminal: { heldWorkItemId: "anchor", graphRunId: "run", column: "in-review" },
    terminalBlock: { reason, resumeActor: actor } }) } as unknown as Pick<TaskStore, "readWorkflowOverlayCurrentTerminal">;
}
describe("terminal display enrichment", () => {
  it("projects a native validated hold without changing native phase or input", async () => {
    const [row] = await enrichTaskTerminalDisplays(reader(), [held]);
    expect(row.terminalDisplay).toMatchObject({ kind: "blocked", reason: "missing-input", resumeActor: "orchestrator", originColumn: "in-review", anchorId: "anchor" });
    expect(row.column).toBe("in-review"); expect(held.terminalDisplay).toBeUndefined();
  });
  it("omits stale list rows after Reset or replacement and unavailable reads", async () => {
    for (const store of [reader({ ...held, updatedAt: "2026-09-14T01:00:00Z" }), reader({ ...held, id: "T2" }),
      { readWorkflowOverlayCurrentTerminal: async () => ({ current: false }) },
      { readWorkflowOverlayCurrentTerminal: async () => { throw new Error("unavailable"); } }]) {
      const [row] = await enrichTaskTerminalDisplays(store as Pick<TaskStore, "readWorkflowOverlayCurrentTerminal">, [held]);
      expect(row.terminalDisplay).toBeUndefined();
    }
  });
  it("does not guess unknown reasons or contradictory release actors", async () => {
    for (const store of [reader(held, "unknown"), reader(held, "missing-input", "human")]) {
      expect((await enrichTaskTerminalDisplays(store, [held]))[0].terminalDisplay).toBeUndefined();
    }
  });
});
