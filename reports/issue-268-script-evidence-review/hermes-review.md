PASS.

The commit introduces bounded script-execution evidence (actual stdout/stderr + exit code on success; real error diagnostics on failure) without altering gate/advisory routing or retry behavior. The changes are internally consistent and the supplied regression tests cover the new paths.

What changed and why it holds:

- `workflow-script-step.ts`: on success, returns `output` carrying the success line, `Exit code: 0`, and truncated stdout/stderr when present. On failure, the error path already assembled diagnostics; no change there. Exit-code verdict semantics are untouched.

- `run-graph-custom-node.ts`: `stepOutput` falls back to `outcome.error` for failed scripts so the node result's `contextPatch.output` carries real evidence instead of being empty. `contextPatch.scriptSucceeded = outcome.success` is set for script mode only, used downstream as evidence, not for routing.

- `workflow-graph-executor.ts`:
  - Introduces `progressId` (concrete instance id for foreach template children, else `node.id`) and threads it through `recordNodeProgressStart`, `recordNodeProgressFinish`, and `discardWorkflowStepLease`. This prevents lease/result collisions across foreach iterations.
  - `shouldRecordNodeProgress` now records script nodes regardless of review kind, while prompt/gate still require a declared review kind. This matches the evidence goal and the test expectation that ordinary scripts produce `source:"node"` records.
  - `recordNodeProgressFinish` status logic: `scriptSucceeded === false` gates "passed" for scripts, so a failed script cannot be recorded as passed. Failed scripts still resolve to "failed" via the outcome check.
  - Best-effort task-log publish is gated on `recorded.scopeCurrent && recorded.persisted` and wrapped in try/catch so a log sink failure cannot re-dispatch or change results.

No introduced bug found in the supplied diff. Limits: review is bounded to the named files and the provided test; unsupplied call sites, `truncateWorkflowScriptOutput` definition, and runtime data shapes are assumed consistent with existing usage. No tests were executed.
