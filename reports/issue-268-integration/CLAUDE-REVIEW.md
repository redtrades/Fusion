# Source review: Fusion a889f0c0b8c4782619b7ed663bdc7503b6854d21 (issue #268)

Reviewer: Claude (Anthropic), desktop session. Read-only. Parent 2fd2432092f9ba3092e5939f46ca6267295f08ed.
Export: /tmp/268-reset-review-source. Cross-checked against `git show <sha>:path` in a separate Fusion
worktree sharing the same object store (not the mutable shared Fusion checkout). No execution, no edits,
no auth/lock/live-4040/KB-003 changes.

## Integrity note

The manifest hash given in chat (`665db7e84a468dae747958a7d1cfda02fba093e09d3646a4dec1331dfe1fd56b`) does
NOT match the actual sha256 of `SHA256-manifest.json` on disk (`665db7e84a468dae747958a7d1cfda02fba093e09f3646a4dec1331dfe1fd56b`,
one hex digit different at position 41: `d` vs `f`). Per the "root transcription may differ" caveat, I did
not treat this as tampering. I verified all 24 files inside the export against the manifest's own per-file
hashes (0 mismatches) and separately verified 19 of them (all head/base source files) against `git show
<sha>:path` output from the actual Fusion object store (0 mismatches, files present at both SHAs). The
export's content is authentic and matches the named commits regardless of the one-line transcription slip.

## Verdict: PASS

## What this commit does

Consolidates worktree-path canonicalization into one function, `canonicalizeWorktreePathSync` (new, in
`worktree-path-reservation.ts`), which realpaths the full path when it exists, or walks up to the nearest
*existing* ancestor, realpaths only that, and rejoins the still-absent suffix literally. This is the exact
algorithm `worktree-pool.ts`'s private `canonicalizePath` already used (dated comment "2026-07-15", i.e.
pre-existing, battle-tested logic) — moved to a shared location, not new risky logic. `worktree-pool.ts` now
delegates to it instead of keeping its own copy. `task-reset-targets.ts`'s `buildTaskResetWorktreePlan` and
`register-task-workflow-routes.ts`'s reset handler both switch from bare `resolve()` to this same function for
every path comparison (target dedup, singular-worktree fallback, alias matching, repo-root/containment-root
comparison, registered-path lookup keys, `isStrictDescendant`).

**The actual bug this fixes**: on macOS, `/tmp` is a symlink to `/private/tmp`. Before this commit, worktree
*creation* (`worktree-pool.ts`) canonicalized through the symlink (`/private/tmp/...`) while Reset planning
(`task-reset-targets.ts`) used bare `resolve()` (`/tmp/...`, unresolved) — two different strings for the same
physical location, causing Reset to see a path it didn't recognize as its own and refuse with a false
ownership conflict. This is a consistency fix, not primarily a new escape-detection feature.

## Focus areas, verified against the actual mechanism (not just tests passing)

**Missing-ancestor handling is confirmed to add no new escape surface.** The fallback walks up until it finds
an *existing* ancestor, realpaths only that, and appends the not-yet-existing suffix as a literal string — it
never resolves through a path component that doesn't exist yet. A malicious symlink can only be walked through
if it already exists at canonicalization time, in which case `realpathSync` on the full path succeeds directly
and returns the true physical target. Either way, the function always returns the real physical location when
one is resolvable, and the caller-side containment checks operate on that resolved value.

**External/symlink escape protection got strictly stronger, not weaker.** I traced the actual containment gate
in `register-task-workflow-routes.ts`'s reset handler (read in full, not just the diff hunk): `target.canonicalPath`
is now the fully-resolved physical path (from `buildTaskResetWorktreePlan`), and the *first* containment check
(`target.canonicalPath === canonicalRoot/canonicalRepoRoot/canonicalContainmentRoot || !contained`) now runs
against that resolved value. Before this commit, `target.canonicalPath` was a bare `resolve()` — a string that
"looks contained" even when it points elsewhere via an unresolved symlink — so containment for an as-yet-unrealized
target relied entirely on the pre-existing *second* check (`if (targetExists) { const resolvedPath = await
realpath(...); ... }`), which only ever ran when the path already existed. Post-fix, both layers agree and the
first layer alone is now sufficient. The new "escape" test case (symlink chain: alias→physical,
`physical/.worktrees/escape`→an outside directory) exercises exactly this and expects 400 with nothing removed
and no publication call — consistent with what the code does.

**Live-holder / alias session fences: real gap closed, traced end to end.** The new block in the removal loop
(`register-task-workflow-routes.ts`) iterates every *raw* recorded path on the fenced task (`target.worktreePath`,
`fencedTask.worktree`, each workspace child's `worktreePath`), and for any one that canonicalizes to the same
physical target but is a different string, calls `reconcileTaskResetSessionRoot` on that *raw/alias* string
before removal. Before this commit, only the canonical/physical path was ever reconciled, so a session actively
registered under an alias string (e.g. the unresolved `/tmp/...` form) would never be seen by Reset, letting it
remove a worktree a live session still held. The new "live-alias" dashboard test registers a session under the
alias path specifically and expects 409 with nothing removed — this now works because of the new reconciliation
loop, not by accident. `reconcileTaskResetSessionRoot` is registry bookkeeping only (no filesystem operation),
so feeding it unvalidated raw path strings from the task record introduces no traversal risk of its own.

**Reservation-key consistency confirmed via caller audit, not assumption.** `callers.txt` (exact-head `git
grep`, cross-checked: every listed reference at `a889f0c0` genuinely exists at those line numbers) shows every
caller of `acquireWorktreePathReservation` / `canonicalizeWorktreePath` across `packages/cli`, `packages/core`
(archive-lifecycle), `packages/engine` (worktree-acquisition, executor lifecycle, healing disposer,
worktree-pool) routes through the same async wrapper, which now delegates to the one sync implementation. No
caller of the reservation/canonicalization API was left on a divergent path. This does not rule out some
unrelated site doing its own bare `resolve()`-based ownership comparison outside this call graph — the grep by
construction can't see call sites that never reference these symbols at all — noted as a review-method limit,
not a found defect.

**Ownership checks unaffected in substance.** The branch/registered-path ownership proof logic
(`registeredOwner` / `recoveredCanonicalOwner` / foreign-owner cross-task scan) is untouched by this diff except
for the key computation switching to the canonical function; I traced all six dashboard test modes
(`branch`, `canonical-id`, `unregistered`, `foreign-owner`, `live-alias`, `escape`) against the actual route
logic and each produces the status the test expects for the stated reason, not coincidentally.

## Non-blocking observation

None found. The new tests are real (spawn actual symlinks and temp directories, exercise the real route
handler with a real Express app via `performRequest`, not mocked-away assertions).

## Not verified by this review

Live KB-003/deployment state, the atomic A3/A4 bindings referenced in `reconciliation.md` (out of this diff's
scope), whether this commit is actually integrated into any downstream composition branch, and any runtime
behavior. `reconciliation.md`'s claim that a separate integration branch (`a83b0e29...`) still has old lexical
`resolve()` describes *that other branch* pre-merge, not a defect in `a889f0c0` itself. No claim on the WS 1.7
8-check battery or the 3-traversal acceptance, which remain separate.
