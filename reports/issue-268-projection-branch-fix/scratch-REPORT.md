# A2 conditional branch regression

Fallback evidence: frozen committed source e582139d5c352ad8fd52b7fcb27d658f1be09bc4 and compiled native validator/walker. Source tree unchanged and clean. No commands, DB, native CLI, or inference were launched by test handlers.

## Confirmed F1

`repro.mjs` executed with Node v22.23.2, exit 0. Assertions confirm the regression, not desired product behavior. `result.json` records both paths.

Native `parseWorkflowIr` accepts the complete graph start -> parse-steps -> foreach -> end. Foreach is shared/sequential, four blocking named-script nodes: select -> left (outcome:passed) or right (outcome:failed), both converging at finish. The synthetic handler returns the actual native script success shape (outcome success, value passed, scriptSucceeded true).

With projection factory absent, native runForeach visits select,left,finish and succeeds/completes. With A2 projection present, identical execution accepts start but refuses completion without invoking the complete callback: step-projection-completion-refused. The unselected right node causes 3 != 4.

Exact frozen-source references:
- packages/core/src/workflows/workflow-ir.ts:550-582 requires one structural entry/exit and permits this diamond; parseWorkflowIr:1826 invokes native v2 validation.
- packages/engine/src/workflows/workflow-graph-foreach.ts:439 eligibility admits all four scripts.
- same file:1184-1196 chooses one matching forward edge, rather than executing every template node.
- same file:1052-1072 already rejects every executed skipped, failed, cancelled, or unverified script.
- same file:1079 introduces erroneous all-template-node cardinality requirement.
- packages/engine/src/executor/run-graph-custom-node.ts:1035,1123 supplies the success boolean and passed result modeled by fixture.

## Recommendation

Replace all-template cardinality with verified traversed-path completion while retaining the per-executed-node checks and fenced native completion ACK. Require the walker to reach the template's structural exit (ignoring rework back-edges) before completion; merely removing cardinality would also allow a non-exit node with no matching outgoing edge to complete. Test valid diamond success plus unmatched edge at non-exit refusal, executed skip/failure/advisory/cancellation refusal, and unchanged ownership fencing. Do not silently exclude conditional templates from projection: they fit current shared/sequential blocking-script scope and are accepted native IR.

No production modification is included. Exact additional review required after any fix; independent PASS on e582 does not erase this reproduced regression.

## Negative evidence

First scratch fixture omitted the required top-level parse-steps predecessor and native validation correctly rejected it before traversal. Added the supported parse-steps kind with PROMPT.md/markdown config; validator then accepted. This was fixture setup correction, not production modification.

Compiled SHA256:
- workflow-graph-foreach.js e56026a0715979e9678fcc8db78cab40918c812b34775be55510034e68379e83
- workflow-ir.js 1107834e6c2c085895ca8f045ee979427e8da98c1f42ba44c7dba6ca6912f62f
