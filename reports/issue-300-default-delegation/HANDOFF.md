# Issue 300 — current-node native delegation

Owner: OpenAI Codex delegated worker; isolated branch feat/300-plugin-default-delegation.
Base Fusion 2fd2432092f9ba3092e5939f46ca6267295f08ed. No shared-checkout edits.
Evidence mode: committed source and local deterministic tests; no inference/runtime acceptance.

## Approved bounded plan

1. Test through WorkflowGraphExecutor.run and the real extension registry: current-node
   delegation, repeat calls, abort, post-delegation plugin failure, unchanged legacy plugins.
2. Add optional zero-argument runDefault to WorkflowNodeHandlerInput and bind it only
   after native prepare/principal admission. Memoize the native handler promise; never
   re-enter extension dispatch. Do not degrade or retry plugin faults after delegation.
3. Preserve native projection/review persistence outside the extension. Add changeset,
   run focused regressions/lint/type checks, commit locally, export a private patch.

Exact implementation scope: packages/core/src/workflows/workflow-extension-types.ts;
packages/engine/src/workflows/workflow-graph-executor.ts; existing
packages/engine/src/__tests__/workflow-node-handler-extensions.test.ts; changeset and this handoff.
No Reset, core index, service or task changes.

## Result and verification

The optional `runDefault()` capability delegates only the captured native handler
for the current admitted node with its original task, settings, context and signal.
Calls share one promise per plugin invocation, including rejection. Before first
native invocation it rejects cancellation, invocation expiry, and mutation of the
admitted node/task/context. Existing nondelegating plugin fallback remains intact.
Once delegation is requested, plugin failure cannot fall through and dispatch again.
The executor drains unawaited native work before releasing admission. Escaping
native exceptions retain the native preparation/suspension/retry classifier; native
retries create a fresh admitted invocation. Plugins can return explicit failure.
This is a trusted plugin API, not a sandbox against arbitrary in-process code.

Verified locally (no inference, service startup, live task mutation or publication):
- Real registry + WorkflowGraphExecutor fixture suite, graph handler suite and graph
  parity suite: 3 files, 50 tests passed (`/tmp/fusion300-final-tests.log`).
- Core and engine TypeScript checks passed (`/tmp/fusion300-final-core.log`,
  `/tmp/fusion300-final-engine.log`).
- ESLint on both modified production files passed (`/tmp/fusion300-final-lint.log`).
- Changeset format and git diff whitespace checks passed.
- Fixture handlers replace the actual session launcher; these results prove the
  delegation boundary, not a cli-agent session, durable session identity or pilot acceptance.

## Negative evidence and remaining gates

- Before implementation, delegation tests failed because the capability was absent.
- Mutation tests then failed: captured object references alone allowed changed
  input. Added a plain-data snapshot with function identity preservation and a
  pre-dispatch equality check. Unsupported non-plain contexts refuse delegation;
  real production context compatibility remains an acceptance check.
- Native preparation refusal initially became `plugin-node-handler-error`; the
  regression test failed. Original native error identity now reaches the existing
  executor classifier, including when the plugin starts work without awaiting it.
- An initial suspension test imported a private/non-exported class; replaced it
  with exported WorkspacePreparationError to test the native classification path.
- ESLint ignores the test file by repository configuration; tests execute through
  Vitest. Full workspace Build/Gate and boot smoke were not run. Boot/services are
  outside this task's authorization. No source-level independent review yet.
- Do not push: both configured Fusion destinations are public. Parent owns private
  integration artifact custody, live acceptance and independent review. No merge.
- Rejected generic createAiSession bridge: it does not retain the already-admitted
  task/session/budget/cancellation path. No arbitrary node/config/task override API.

## Coordination

Root owns agents issue 300 and publication/integration decisions; Muse recovers the
actual project/task IDs and approved prompt pack. The standards_review worker owns
only the private overlay/plugin foundation. Muse's issue 268 worker retains shared
Fusion ownership; this worktree never edits its files. This capability is optional;
legacy runtimes are detected by absence of `input.runDefault` and must fail closed
for overlays requiring native delegation.

## Claude source review corrections (supersedes initial snapshot limitation)

Claude reviewed b49fad7b7565315d4ed1d69f79e8075e35dc4300, agents issue300 comment5657739669,
PASS with findings. Root requested correction before acceptance. F1–F4 reproduced
as five failures in the expanded real-executor fixture suite
(`/tmp/fusion300-review-red.log`, 5 failed/22 passed). Replaced clone-vs-original
comparison with descriptor snapshots on both sides. Class prototype identity,
function fields, symbol/non-enumerable descriptors, cycles and accessor identity
are preserved. Getters are never invoked. Date/Map/Set/RegExp native state is read
through intrinsic methods, bypassing custom accessors/iterators. Private class
fields and closure state are explicitly opaque capabilities; proxies, weak
collections, promises and binary buffers/views reject delegation with an accurate
unsupported-data error. No snapshot is made when there is no native handler.

F5 narrows runDefault to success/failure results and documents that native error
identity must be preserved when rethrowing for native classification. No new
execution capability or launcher change.

After corrections: 63 tests passed across the same three focused files; core and
engine typechecks and production-source ESLint passed. Logs:
`/tmp/fusion300-review-final-tests.log`, `/tmp/fusion300-review-core.log`,
`/tmp/fusion300-review-engine.log`, `/tmp/fusion300-review-lint.log`.
The preceding 733-test gate, full standard workspace build, and linked-runtime
boot smoke belong specifically to b49fad7, not this changed source. Stock boot
failed a baseline bundled macOS ICU link issue; local ABI-linked smoke passed.
Detailed separate evidence: `/tmp/fusion300-integration/BUILD-GATE-VERIFICATION.md`.
Temporary PG verification server was stopped cleanly. Independent review of these
corrections and live acceptance remain outstanding.

Native session association remains a separate scope boundary: run-cli-agent-node
maps CliTaskOutcome to WorkflowNodeResult but drops its exact sessionId. Suggested
bounded follow-up is an additive node-keyed contextPatch containing that ID on
terminal returns; no lookup of a latest/task session and no launcher changes.
No edits to that production file in this correction.

## A2 — exact native session association

Root recorded expanded scope in agents issue300 comments5657780833 and5657793651:
`executor/run-cli-agent-node.ts`, `executor/run-graph-custom-node.ts`, and focused
receipt tests. Implemented in a separate commit after snapshot correction
f3430e17945f747a701cb010a9dd42c3e1ab47f0.

`CliTaskOutcome.sessionId` from the actual awaited native session result now travels
in `contextPatch["node:<runtimeNodeId>:cliSessionId"]` for success, killed,
auth-failed, user-exited and needs-attention. Existing classifications, success
reaping and session-handle cleanup are unchanged. Runtime/worktree/adapter/capacity
refusals provide no receipt. Native session exceptions retain existing propagation.
No new launcher, session enumeration, latest-session inference or persistence write.
The overlay must verify this exact native store record against its admitted run and
lease before CAS persistence; this mapping does not prove that adoption itself.

Negative finding: foreach retains the original template node.id.
executeMaterializedTemplateNode instead writes graph context's
`workflow:node-instance-id`. A template-only receipt key would collide. The native
runGraphCustomNode call site now forwards that host context identity as an optional
argument; absent context falls back to top-level node.id. Plugins receive no new
identity override capability. Tests use the real materializedTemplateNodeId resolver
and runGraphCustomNode call site to prove distinct iteration keys and top-level
fallback, with launch stubbed rather than inference invoked.

TDD evidence: the initial terminal-mapping fixture failed5 cases, and adding the
foreach call-site fixture produced the additional intended failure, before the
implementation. Logs `/tmp/fusion300-receipt-red.log` and
`/tmp/fusion300-receipt-red2.log`. Final relevant regression run passed87 tests across
6 files (`/tmp/fusion300-receipt-final-tests.log`). Engine typecheck, both changed
production files' ESLint, changeset format and git diff checks passed
(`/tmp/fusion300-receipt-types.log`, `/tmp/fusion300-receipt-lint.log`).
No full Build/Gate claim on this new revision; the earlier full evidence remains
pinned to b49fad7. Changed-source review and live acceptance remain outstanding.

Claude independently PASSed snapshot correction f3430e17945f747a701cb010a9dd42c3e1ab47f0
in issue300 comment5657810536. Its N2 documentation clarification is included here:
prototype contents and structurally equal alias replacement are outside admission
comparison, consistent with the trusted in-process boundary. N1 Buffer/typed-array
compatibility must be checked against actual production context before acceptance;
no speculative binary support was added. N3 traversal-cost profiling is deferred.
