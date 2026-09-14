# Source review: Fusion ed4de5149e2ce84e857cd0b3ae68999408119ea0

Reviewer: Claude (Anthropic), desktop session. Read-only. Base 0e2ee6dc26329caebb21b605af947e7039ad508e. Author: OpenAI/Codex.
Repo: /Users/man/worktrees/Fusion/303-codex-structured-handshake. No code run, no edits, no auth/config change, no Codex execution.

## Verdict: PASS

## Scope reviewed

Full diff of the 7 source files (codex-app-server-session.ts new; session-manager.ts, task-session.ts,
token-usage-observer.ts, token-budget-capability.ts, cli-token-usage-types.ts, cli-token-usage-ops.ts changed),
plus all 4 changed/added test files, the changeset, HANDOFF.md and VERIFICATION-NEGATIVE.md, and the codex
adapter's buildLaunch/buildBaseArgs/appendPostureFlags/buildNotifyOverrideArg (caller, not in the diff, read to
check a specific hypothesis below). Did not review the postgres migration/schema files beyond the ops.ts diff,
and did not execute anything.

## What was checked against the stated emphasis

- **Handshake/turn correlation**: `nativeIdentity` is set only after `onIdentity` resolves; `turn()` awaits
  `ready()` first, so no turn can be dispatched before identity is bound (codex-app-server-session.ts:181-217).
  `turn/completed` and `item/agentMessage/delta` notifications are filtered on `turnActive` and matching
  `threadId`, so late or foreign-thread notifications are dropped, not misapplied (lines 241-247).
- **No automatic approval**: any inbound JSON-RPC request from the peer (`method` + `id` present) throws
  immediately (line 230) — verified against a real synthetic peer in `codex-structured-handshake.test.ts`
  ("does not autoapprove native server requests").
- **Cancellation**: `kill()` sends `turn/interrupt` best-effort then calls `fail()`, which rejects all pending
  and kills the child; a duplicate/unmatched RPC response arriving after `fail()` is a no-op (guarded by
  `if (this.failure) return`). Tested end-to-end in `cli-codex-structured-pipeline.test.ts` — cancellation while
  the durable admission write is gated open provably prevents `turn/start` (receipt file never created).
- **No success before drain+ACK**: `task-session.ts` `onMachineState("done", ...)` gates `finish({kind:"success"})`
  behind `usageObserver.drain()` for the structured path exactly as for the PTY path (lines 494-501, 550);
  drain throws if no usage was ever observed for the turn, converting to a kill, not a silent success. A test
  explicitly exercises the mid-drain window ("retains the native task until the final durable accounting
  acknowledgment") and confirms `isSettled === false` until the gated ACK releases.
- **Identity boundary (F1 from the accepted plan review)**: the implementation rejects `thread.id !== thread.sessionId`
  outright (line 189) rather than treating them as interchangeable — stricter than the plan text, which is the
  correct direction; no test yet exercises the divergent case end-to-end through the manager (only the
  low-level `codex-structured-handshake.test.ts` "divergent" fixture, which does cover it directly at the
  transport layer). Consistent with what the implementer told the lead they were adding.
- **Settings preservation**: the `-c`-pairs-only validation on `launch.args` (session-manager.ts:356-358) rejects
  `--dangerously-bypass-approvals-and-sandbox` (the one non-paired flag `appendPostureFlags` can emit) rather
  than silently dropping or honoring it. Checked against the actual adapter source (`codex.ts` buildBaseArgs /
  appendPostureFlags / buildNotifyOverrideArg): the default path (no autoApprove posture, no extraArgs) always
  produces zero or `-c`-paired args, so the common case is not broken by this guard — the guard only fires on
  the one case it's meant to fire on. This was the one place I suspected a functional break; tracing the actual
  caller shows it is deliberate fail-closed behavior, not a bug.
- **Fencing re-check before dispatch**: `beforeFirstTurn()`'s poll write re-validates ownership/budget through
  the same fenced `recordCliTokenUsageFenced` path used at admission, closing the window between fresh admission
  and `turn/start`. Directly tested ("reaffirms absent-file admission after concurrent ownership/budget change
  before dispatch") — both concurrent-ownership-change and concurrent-budget-change cases kill before dispatch
  with no receipt written.

## Non-blocking observations (not FIX)

1. `token-usage-observer.ts` `beforeFirstTurn()`: `this.beforeFirstRequest = true;` right after the guard that
   already requires it to be true is a dead assignment (the guard, not this line, is what makes it a one-shot
   latch via the `finally` reset to `false`). Harmless, just confusing to read.
2. `codex-app-server-session.ts` `kill()`: writes `turn/interrupt` directly to `child.stdin` without registering
   a `pending` entry, so its own RPC response (if the peer sends one) always dead-ends in `receive()`'s
   "Unexpected Codex RPC response identity" throw. This is swallowed by `fail()`'s idempotent early-return
   (already fired), so no functional effect, just a slightly noisy internal path.
3. Test coverage: the old PTY-path test "accepts a trusted transcript alias and canonical Codex cwd for the
   same worktree" was removed (Codex now always takes the structured path) and replaced with a guard test. The
   alias/symlink-cwd scenario itself is still covered, but only at the observer unit level
   (`cli-fresh-codex-observer.test.ts` "binds matching canonical cwd aliases"), not through the full
   manager/task-session pipeline for the structured path. Worth a follow-up test, not a blocker.

## Not verified by this review

Runtime acceptance against the real installed Codex binary; the `@fusion/core` `superviseSpawn`/lifecycle
internals (reused, not modified, treated as trusted); the postgres migration/schema beyond `cli-token-usage-ops.ts`;
anything outside the 7 source files + tests listed above. This review is source-only, at the exact stated
revision, and makes no claim about the 8-check WS 1.7 battery or the 3-traversal acceptance, which remain
separate per prior agreement.
