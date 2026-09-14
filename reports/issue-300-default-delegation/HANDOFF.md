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
