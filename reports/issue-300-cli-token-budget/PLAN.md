# Native observed CLI token budget implementation plan

Evidence mode: current Fusion source, root-verified CLI usage-only fixtures, native
identity hook discovery supplied by root. Base9cc409405a13e2443b2ab1d891e7b2a3d373b0ab.
Owner: delegated root/spec_review. No public push, live4040, credentials change,
local inference, or edits to shared/integration trees. No fleet aggregate claim.

## Contract and file scope

1. New engine cli-agent/token-usage.ts parses only numeric usage events into
   typed observations: Codex cumulative totals subtract cached input from input,
   never add reasoning output twice; Claude assistant message IDs deduplicate
   repeated snapshots. Invalid usage fails closed. Versioned sanitized fixtures
   seed tests; no transcript prose is captured in artifacts.
2. New core cli/cli-token-usage-types.ts and task-store/cli-token-usage-ops.ts,
   store.ts forwarding/export: atomically persist bounded typed ledger under
   sourceMetadata.cliTokenUsage together with existing aggregate token columns.
   Use existing task advisory transaction lock plus row lock; validate exact
   task/project/native CLI session and live run/lease/agent/node. No generic
   updateTaskAtomic claim of cross-process safety. Growth refusal, no eviction;
   replay/resume checkpoint prevents duplicate accounting. No A4 file changes.
3. Engine cli-agent/session-manager.ts beforePtyStart(record) runs after durable
   record and before child spawn. task-session.ts mints token, writes hook scripts,
   registers identity observation there. Preserve existing native PTY/kill path.
   adapters/codex.ts adds native SessionStart hook configuration and actual notify
   program wiring. dashboard routes/cli-agent-hooks.ts keeps authenticated native
   identity/path internal and correctly normalizes Codex completion; other adapter
   semantics remain unchanged. No hook trust bypass or credential rewrite.
4. New engine cli-agent/token-usage-observer.ts performs bounded incremental
   reads of the exact authenticated native path, validates identity, establishes
   baseline before prompt, polls usage and persists through native fenced method.
   Missing capability/identity, malformed usage, read or persistence errors stop
   protected execution. CliTaskSession gates injection on observer readiness,
   drains final usage before success and calls native kill on hard crossing.
5. executor/run-cli-agent-node.ts supplies store/current run admission, resolves
   existing task budgets and refuses exhausted task before another launch.
   Existing concurrency/token-budget-enforcer.ts semantics define work tokens:
   input + output + cache writes; cache reads excluded. Stop/pause occurs after
   observed crossing, so in-flight overshoot is explicit.

## Verification sequence

- [x] Failing then passing normalized fixture tests, cumulative replay/resume,
      Claude message updates, invalid/count-overflow cases.
- [x] Fenced persistence tests: multiple sessions, duplicate receipt, restarted
      observer, wrong project/native ID, stale lease/Reset, bounded ledger.
- [x] Real native pipeline tests with fake PTY and local usage-only JSONL:
      hooks exist before spawn, no prompt before authenticated identity/readiness,
      threshold stops child and pauses task, no second launch after exhaustion,
      final drain precedes success and parser failure cannot report protection.
- [x] Focused regression tests, source typecheck/build and changeset/lint checks.
- [x] Local tested commit and negative-evidence handoff for independent review.

Known prerequisite defects: transcript tailers have no production consumers;
Codex notify program was not passed from task-session; dashboard mapped notify to
waiting rather than Codex done; Claude transcript path was dropped; scripts were
written after spawn, racing SessionStart. These are required scope, not a new
executor. Native hook trust compatibility remains a verification boundary.

Implementation and selected checks complete. Independent source review and root-owned native CLI trust/version canary remain acceptance gates, not implied by these checks.
