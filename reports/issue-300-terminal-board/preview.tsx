// Local no-service visual fixture; no native lifecycle actions.
import React from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import "../../packages/dashboard/app/styles.css";
import { Board } from "../../packages/dashboard/app/components/Board";
import { writeBoardWorkflowsCache } from "../../packages/dashboard/app/utils/boardWorkflowsCache";
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { app: {} } } });
const workflow = { flagEnabled: true, defaultWorkflowId: "fixture", workflows: [{ id: "fixture", name: "Tier 1 fixture", columns: [
  { id: "in-progress", name: "Implementation", flags: { countsTowardWip: true } },
  { id: "in-review", name: "Review", flags: { humanReview: true } }
]}], taskWorkflowIds: { "TASK-1": "fixture", "TASK-2": "fixture" } };
writeBoardWorkflowsCache(undefined, workflow);
window.fetch = async (input) => new Response(JSON.stringify(String(input).includes("board-workflows") ? workflow : []), { headers: { "Content-Type": "application/json" } });
const tasks = ["blocked", "escalated"].map((kind, index) => ({ id: `TASK-${index + 1}`, title: index ? "Review needs human decision" : "Waiting for required input", description: "Fixture only", column: index ? "in-review" : "in-progress", dependencies: [], steps: [], log: [], currentStep: 0, paused: true, status: "paused", updatedAt: "2026-09-14T00:00:00Z", createdAt: "2026-09-14T00:00:00Z", terminalDisplay: { kind, reason: index ? "validation-inconclusive" : "missing-input", resumeActor: index ? "human" : "orchestrator", originColumn: index ? "in-review" : "in-progress", anchorId: `anchor-${index}`, runId: "fixture-run", taskRevision: "2026-09-14T00:00:00Z" } }));
const root = createRoot(document.getElementById("root")!);
const render = (rows) => root.render(<Board tasks={rows} maxConcurrent={2} onMoveTask={async () => { throw new Error("Fixture forbids moves"); }} onOpenDetail={() => {}} addToast={() => {}} />);
render(tasks);
window.resetTerminalFixture = () => render(tasks.map(task => ({ ...task, terminalDisplay: undefined, paused: false, status: "queued", updatedAt: "2026-09-14T01:00:00Z" })));
