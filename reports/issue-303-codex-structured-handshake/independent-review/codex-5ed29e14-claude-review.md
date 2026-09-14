# Source review: Fusion 5ed29e14ff04e7998b2e4310a6c601a6a13f433e

Reviewer: Claude (Anthropic), desktop session. Read-only. Parent ed4de5149e2ce84e857cd0b3ae68999408119ea0,
original base 0e2ee6dc26329caebb21b605af947e7039ad508e. Author: OpenAI/Codex.

## Provenance note (corrects the prior review)

The prior review at `/tmp/agents-intent-alignment-20260914/codex-ed4de514-claude-review.md` read test/source
content via direct filesystem `cat` against the Fusion worktree, not `git show <sha>:path`. That worktree had
this follow-up's work landing in it while I read, so that review's PASS was not a valid exact-revision verdict
on `ed4de5149` alone and is now understood to have been wrong in substance, not just in method: `ed4de5149`
alone had a real, reproduced gap (below). That file is left unchanged per instruction; this is a fresh review.

## Method this time

Verified the export's integrity independently rather than trusting `manifest.json`: computed sha256 of
`git show 5ed29e14:<path>` for all 17 files myself and diffed against the manifest's recorded hashes — 0
mismatches, 0 malformed entries. Confirmed `5ed29e14`'s parent is exactly `ed4de5149` via `git show -s --format='%P'`.
All source content below is `git show <exact-sha>:<path>` output, never a worktree read.

## Verdict: PASS

## What changed between ed4de5149 and 5ed29e14, and why it was needed

`git diff --stat ed4..5ed29e14` touches exactly: `cli-token-usage-ops.ts` (+9/-2), `token-usage-observer.ts`
(+18/-1), `cli-codex-structured-pipeline.test.ts` (+15), `cli-token-usage-fenced.pg.test.ts` (+16, new test),
the changeset line, and a new `PENDING-FENCE-FOLLOWUP.md` report plus logs. `codex.ts`, `session-manager.ts`,
`task-session.ts`, `codex-app-server-session.ts` are byte-identical to `ed4de5149` (not in the diff).

**The gap.** In `ed4de5149`, `beforeFirstTurn()`'s single pre-dispatch read called `read(false, false)`, which
for an absent-or-empty future file returns silently on ENOENT without ever calling `recordCliTokenUsageFenced`
again. That means between the initial fresh-admission write (at `admitFresh`, potentially several polling
intervals or more earlier) and the actual `turn/start` dispatch, there was no re-check of current owner or
current budget if the native file simply hadn't appeared yet — which per `HANDOFF.md`/the earlier no-turn
receipt is the normal case (`path absent both at response and after stdin-close`). I confirmed this against
the pinned `ed4de5149` content in the prior review's diff extraction; the `PENDING-FENCE-FOLLOWUP.md` report at
`5ed29e14` independently corroborates it and includes the RED log (`fusion303-reaffirm-red.log`, read via
`git show`): 2 of 7 tests failing at `ed4de5149` for exactly the two `it.each(["ownership","budget"])` cases in
`cli-codex-structured-pipeline.test.ts`.

**The fix.** `beforeFirstTurn()` now issues an explicit `reaffirm: true` write (empty observations,
`baseline: false`, the *same* `awaiting-file` cursor, zero bytes, no `fileIdentity`) when the header still
isn't verified after the read attempt. Server-side, `recordCliTokenUsageFencedImpl` (read in full at the pinned
SHA, not excerpted) re-reads the **live** task row inside the same transaction (`readTaskRowInTransaction`,
under `.for("update")` and an advisory lock) and re-checks `task.checkoutRunId/leaseEpoch/checkedOutBy/checkoutNodeId`
against the admission object — a live check, not a comparison against the ledger's own cached `owners` entry —
and recomputes `work` from the task's live persisted `tokenUsage` totals, so a concurrent write from an
unrelated session on the same task is reflected. The `reaffirm` branch is validated narrowly: mutually
exclusive with `fresh`; requires a `previousOwner` to already exist (can't manufacture an admission); requires
the ledger's own cursor to still be `awaiting-file` (can't reaffirm past real observations); requires the
cursor shape and `transcriptPath` to match exactly (no path substitution, no fake inode, no fabricated bytes).

**Independent confirmation, not just log-trusting.** I read `cli-token-usage-fenced.pg.test.ts`'s new test in
full: it admits fresh, reaffirms (0 tokens, succeeds), rejects a reaffirm with a mismatched path, rejects a
second `fresh` admission ("already used"), then has a *second, unrelated* native session on the same task
record 21 real tokens, then reaffirms again and asserts `hardExceeded === true` — proving the budget re-check
is live, not a stale snapshot — then calls `resetTaskPublication(..., "todo")` and asserts the next reaffirm
throws "ownership" — proving the owner re-check is live. This is a real PostgreSQL integration test exercising
the actual transactional path, not a mock returning canned values. I traced the production code path this test
exercises line-by-line above; the two agree.

Logs read via `git show` at the pinned SHA: `fusion303-reaffirm-red.log` shows 2 failed/5 passed pre-fix;
`fusion303-reaffirm-all-engine.log` shows 6 files/32 tests passed post-fix. Consistent with the reported
32-engine count; I did not independently re-run the suite (per instruction, no execution), only verified the
logs are for this exact commit and the production logic they describe matches what's actually in the diff.

## Non-blocking observations (carried from the ed4 review, still true, unaffected by this follow-up)

Same three items noted in the ed4 review (dead assignment in `beforeFirstTurn`'s now-redundant `this.beforeFirstRequest = true` line, the harmless swallowed internal throw on `kill()`'s unregistered `turn/interrupt` response, the alias/symlink pipeline-level coverage gap) are unchanged by this commit — none are touched by the diff, none are newly introduced.

## Not verified by this review

Runtime acceptance against the real installed Codex binary; `@fusion/core` internals; anything outside the 17
manifested files plus the two additional followup-diff files I pulled directly (`cli-codex-structured-pipeline.test.ts`,
`cli-token-usage-fenced.pg.test.ts`, confirmed via `--stat` were the only test files touched). No claim on the
WS 1.7 8-check battery or the 3-traversal acceptance, which remain separate.
