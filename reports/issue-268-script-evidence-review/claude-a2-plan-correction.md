# Correction to prior A2 judgment (issue #268) — F2 disposed, design re-assessed

Reviewer: Claude (Anthropic), desktop session. Read-only. Source: `f7341dcf5aae04ac3ae3a1744211d949d904b3fc`
(parent `0cbfe89281ed41a1147466a03dc4deefb95f61f9`) in `/Users/man/worktrees/Fusion/268-step-projection-red`,
read via `git show <sha>:path`. No DB/inference/production edits. No full-acceptance claim.

## F2 disposition: DISPOSED, my prior "no extra fence needed" conclusion was wrong

Read the frozen test file and both PG run logs directly (not summarized from the HANDOFF alone).

**reset-replan race: confirmed, reproducible, solid evidence.** Both isolated PG runs fail at the exact same
assertion (`deterministic-step-projection.pg.test.ts`, `expect(current.steps[0].status).not.toBe("done")`,
after `startStep` accepted → `resetTaskPublication` → task republished with a replacement step under a new
`checkedOutBy`/`checkoutRunId`/`checkoutLeaseEpoch` → the deferred `updateStep(..., "done", {source:"graph"})`
from the OLD run still succeeds and marks the NEW owner's replacement step `done`). This directly falsifies my
prior claim that the outer checkout/lease admission (which gates whether a process may be *driving* the graph)
makes stale completion writes impossible: the outer admission is checked once, at dispatch; it is not
re-checked inside the deferred `updateStep` commit. The in-process `withTaskLock` mutex I correctly identified
last time serializes writes *within one process*, but does nothing to stop an old, already-superseded write
from a process that is still allowed to run (nothing revoked its ability to call the store method) from landing
after a Reset has moved the task on. I was right about the lock's scope; I was wrong that the outer admission
substituted for a commit-time check. It doesn't — there isn't one today. **Withdrawn: "no extra fence
required."**

**checkout-release scenario: evidence is real but inconsistent between the two runs, worth flagging precisely
rather than citing as equally settled.** In `actual-pg-red.log` (02:02:52 run) the checkout-release case fails
at line 69, the actual race assertion (`current.steps[0].status).not.toBe("done")`) — a clean reproduction of
"late completion succeeds despite released checkout." In `confirmed-actual-pg-red.log` (02:04:01 run) the SAME
case fails earlier, at line 75, on the setup-verification assertion (`expect(superseded.checkedOutBy)
.toBeUndefined()`) — i.e. `store.updateTask(task.id, { checkedOutBy: undefined, ... })` did not actually clear
`checkedOutBy` (it read back as `"agent-old"`), so that run never reaches the race assertion at all. Two
explanations fit: either `updateTask`'s merge treats an explicit `undefined` field as "don't touch" (common
convention, and if so the test's premise for this one scenario needs `null` or a different clearing API, not
`undefined`), or there's a genuine non-determinism in how/when the clear lands. Either way, right now only ONE
of the two logged runs actually exercises the checkout-release race; the total 3-failed/5-passed count matches
between runs by coincidence, not because both prove the same thing. This doesn't weaken the case for fencing —
reset-replan alone is sufficient, reproducible proof — but the checkout-release scenario specifically should be
re-run cleanly (fix the clear-field assumption first) before it's cited as equally solid evidence in the same
way reset-replan is.

## Advisory-success framing: corrected per your note and the HANDOFF's own recommendation

My prior claim ("`gateMode:gate` is the necessary and sufficient condition") overstated it. Adopting the
HANDOFF's framing directly rather than re-deriving it: A2 must check the actual per-script result fields
(`scriptSucceeded`, absence of `notRunReason`) from context explicitly, not rely on the graph-level outcome or
the configured gate mode as a sufficient proxy — "advisory traversal success and reaching template exit alone
are insufficient" (HANDOFF, verbatim). The four-case negative-control test (`failure`/`skipped`/
`advisory-failed`/`cancelled`) currently passes trivially, because no production callback exists yet to mark
anything done at all — it is not yet evidence that an explicit check is correctly implemented, only that the
absence of a callback is (obviously) safe. Keep this as a requirement on the callback's own logic, not
something satisfied by configuration alone.

## Minimum proposal review: optional ownership tuple on startStep/updateStep, enforced in mutateStepImpl

**Assessment: sound, and independently corroborated by patterns I verified directly in this same codebase
family in an earlier turn of this review.**

- **Opt-in shape is correct.** `ownership: {runId, leaseEpoch, agentId, nodeId}` plus `signal?` as new optional
  fields on the existing `source:"graph"` options object, validated only when present, leaves every other
  caller (agent tool calls, review auto-approval, restart reconciliation, self-healing) provably untouched —
  this is the right way to extend a shared seam without inventing a parallel one.
- **`RunMutationContext` is confirmed insufficient, not assumed.** Read `types/task/task-log.ts` directly:
  `RunMutationContext = { runId: string; agentId: string; source?: string }`. No `nodeId`, no `leaseEpoch`.
  The HANDOFF's claim is exact, not approximate — reusing it would silently drop the two fields that actually
  matter for lease fencing.
- **Enforcement inside `mutateStepImpl` under Reset's advisory + row transaction is the right layer, and it is
  not a novel pattern for this codebase.** This is structurally identical to two mechanisms I independently
  verified in full in this same review session: the Reset physical-path fix's live task-row read
  (`readTaskRowInTransaction`, row-locked) compared against the caller's admission object inside one
  transaction, and `cli-token-usage-ops.ts`'s `recordCliTokenUsageFencedImpl`, which does the exact same
  live-row-vs-admission comparison (`task.checkoutRunId/leaseEpoch/checkedOutBy/checkoutNodeId` vs the caller's
  tuple) inside its own advisory-locked transaction before accepting a write. Extending the same shape to
  `mutateStepImpl` is consistent with an already-proven house pattern, not new machinery.
- **Scope boundary holds.** Existing plain `startStep`/`updateStep` callers (no `ownership` supplied) keep
  today's behavior exactly; only A2's new callback would supply the tuple and inherit the stricter check. An
  absent/partial tuple on a call that *does* request the protected path must refuse, not silently fall back to
  legacy behavior — matches the HANDOFF's explicit statement and is the correct fail-closed default.

No objection to the proposed API shape or enforcement location. The one implementation-order point worth
keeping explicit: this transactional extraction is root's to approve before any A2 callback wiring proceeds —
building the callback against the unfenced seam first (as my prior review implicitly permitted) is exactly
what this RED evidence rules out now.

## What I did not re-verify here

`task-mutation-ops.ts`'s `WorkflowOverlayAdmission` tuple shape (cited as a precedent) — not re-read this turn;
my confidence in the "enforce live-row-vs-admission inside one transaction" pattern rests on the two instances
I already verified directly (Reset fix, CLI token ledger), which is sufficient corroboration without a third
read. No new production source read beyond this frozen test commit and the two files needed to check the
`RunMutationContext` claim (bounded, not broad).
