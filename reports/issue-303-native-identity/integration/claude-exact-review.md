# #303 native identity binding - exact-revision review

Reviewer: Claude (model id `claude-sonnet-5`, "Sonnet 5"), this desktop session, acting
as co-lead reviewer per Mike's alignment task. This is the same model/session that
authored the original design review (`/private/tmp/claude/303-identity-claude-plan-review.md`)
this implementation was built against - noted per root's request for reviewer identity
from the actual session, not inferred.

Evidence mode: fallback - exact pinned Git objects only, read via `git show`/`git diff`
in the Fusion repo. No tests executed, no model subcalls, no source edits. The prior
Hermes review attempt is reported to have timed out at 236s with no verdict (no
recoverable native session usage - runner had no session DB); this review does not
depend on or reference that attempt's output, since none exists to reference.

**Revision under review:** `c7d04532315ce85fd072a33f4446b79edb905065`
("fix(cli): preserve observed identity with fenced usage receipts"), diffed against
`379c94d5e7c3bb824baf9b5c3705781904848c36` (the baseline my design review was written
against - single commit, isolated diff, confirmed via `git log --oneline BASE..SHA`).
Not the worktree's current HEAD (`b974322...`, one docs-only commit ahead, not
reviewed as source).

## Verdict: PASS

The implementation matches the corrected design (both my original identity review and
the mid-turn corrections/addendum it absorbed) closely and carefully, including subtle
asymmetric requirements I did not expect to see honored exactly (sticky-incomplete
coverage, commit-before-fail ordering, bounded-batch continuation past a Codex
`turn_context` mismatch to the following `token_count`). I read every line of every
diff (7 source files, 3 test files, 1 changeset) and hand-traced the control flow
against the new tests; I found no defect. Confidence is high but not test-execution-
grade - I did not run the 51 tests the commit and its own HANDOFF.md report (39 engine
+ 9 PG + 3 core ledger unit), only read and reasoned about their assertions against the
diffed implementation.

## Findings, matched against my own design review's items

**D2' (bounded-commit-through-mismatch-then-stop) - implemented correctly.**
`token-usage-observer.ts`'s `parseLine`/`observeModel` set `this.modelFailure` as a
flag (`??=`, never overwritten once set) rather than throwing synchronously. The
mismatched line's own observation is still pushed to `observations` (the `??=`/early-
return in `observeModel` only stops further identity mutation, not the caller's
`observations.push`). The outer `while` loop is bounded by `stat.size` captured once
at the top of `read()` - it keeps consuming every line already in that snapshot
(matching "finish what's in hand," not "keep polling until usage shows up") rather than
stopping at the very next line, which is exactly how a Codex `token_count` event
arriving *after* a mismatching `turn_context` in the same read is still charged (root's
first correction) - confirmed by the dedicated test "charges Codex usage after the
mismatching context marker in the same trusted batch," which asserts `total()===7` (the
post-mismatch token_count's usage) despite the drain rejecting.

Commit-then-fail ordering is exact: the `recordCliTokenUsageFenced` ack call happens
unconditionally (with `cursor.phase: this.modelFailure ? "failed" : ...`), and only
*after* that ack succeeds does `if (this.modelFailure) throw this.modelFailure;` run,
propagating out to `fail()`/session termination. Untrusted-stream conditions (wrong
native session/inode/cwd/lease, plus a new per-line `cwd` check I hadn't specified but
which follows the same principle) remain hard, synchronous, pre-collection throws with
zero commit - correctly kept distinct from the model-mismatch class, matching my
review's F3 distinction.

**D2'' (failed-terminal guard, write-side) - implemented exactly as specified.**
`cli-token-usage-ops.ts` gained precisely the one-line guard I proposed:
`if (previousCursor?.phase === "failed" && request.cursor.phase !== "failed") throw
new Error("Failed CLI token cursor cannot resume");` - placed before the existing
`previousCursor` identity-check block, no new branch or service. Replay-safety is
inherited from the existing `advanceCliTokenLedger` max-based dedup exactly as I
predicted, confirmed directly by test ("failed cursor charges once and cannot revive":
two identical `failed`-phase writes both return `observedWorkTokens: 7`, and writes
attempting `failed -> observing/drained/baseline/awaiting-file` all reject).

**Coverage field - implemented with correct, asymmetric stickiness.** `coverage:
"incomplete"` is sticky (a write cannot move `incomplete -> anything else`); `complete
-> incomplete` is allowed (needed for the resumed-observer case, where a new observer
instance's blank in-memory state must not silently keep claiming a prior instance's
"complete" status without fresh confirmation). This is exactly the asymmetry my
addendum specified, and I would not have caught the resumed-observer edge case myself
without the dedicated test ("repeated baseline hydrates old evidence without borrowing
approval") - the observer's `if (baseline) { ... hydrate this.modelIdentity from the
ack's persisted identity ... }` block is a real, correct mechanism for this that I did
not think to specify at this level of detail in my own review.

**D3 / `CliTokenBudgetInspection.session.identity` - implemented correctly, including
the codex cross-consistency check.** `token-budget-capability.ts`'s `complete` gate
requires `cursor.phase === "drained"` (not `"failed"`, not any live phase) *and*
`coverage === "complete"` *and* `identity.observed` present, *and* for codex,
`selected.model === observed.model && selected.provider === observed.provider`. No
identity is returned at all when incomplete - never a partial/misleading object.
Legacy/manual reads (`{sessionId, nativeSessionId, phase, workTokens}`) are unaffected
in every case (root concern 2), confirmed directly by test (the four-state matrix in
"exposes only complete drained current-turn evidence without breaking legacy credits").

**Selected/observed provenance separation (root concern 1) - held, not invented.**
`codex-app-server-session.ts`'s `selectedModel`/`selectedProvider` are populated only
from the already-validated `response.model`/`response.modelProvider` (unchanged
validation at the line that already existed pre-diff). `token-usage.ts`'s Claude
`model` field is read directly off `message.model` with a bounded-length/non-empty
check, never used to infer a provider. The changeset's own "dev" line and the
HANDOFF.md's "Negative evidence and limits" section state this explicitly and match
what the diff actually does.

## What I did not verify (read-only, honestly bounded)

- Did not execute any test; my confidence in the 51-test claim is from reading the
  test source and reasoning about it, not from a run.
- Did not verify `validateCliObservedIdentity` is reachable/used everywhere it should
  be beyond the one call site I traced (`cli-token-usage-ops.ts`) - it is not
  re-exported from `packages/core/src/index.ts` (only the `CliObservedIdentity` type
  is), which is fine for its current one internal caller but worth root's awareness if
  a future external caller needs to validate an identity object before submitting one.
- Did not independently re-derive the PG-level test's claim about "unchanged Reset/
  lease/native identity fences and rollback on conflicting identity" beyond the specific
  assertions I read in the diff shown above - the HANDOFF.md claims a broader PG suite
  (9 passes) than the ~3 new `it(...)` blocks I read in the diff; the rest of that
  count is the pre-existing suite (unmodified, not re-read by me in this pass since it
  was already reviewed at the baseline commit).
- Did not check `packages/engine/src/__tests__/cli-token-budget-pipeline.test.ts` or
  any other consumer of `CliTokenUsageWrite`/`CliTokenBudgetInspection` outside the
  files the diff actually touched, for a caller that might construct a request object
  without going through the type and therefore bypass `identity` handling silently
  (unlikely given TypeScript's structural typing on an added *optional* field, but not
  exhaustively swept).

## No blockers found

Nothing in this pass warrants a request for changes. This is a PASS from this
reviewer, on this exact revision, by direct source reading - not a substitute for
root's own composed verification, which this document explicitly defers to per
instruction.
