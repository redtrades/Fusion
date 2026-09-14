# Independent review — issue #300 Hermes cumulative ledger

- **Reviewer:** Claude Sonnet 5, independent reviewer (alongside root Codex and Muse), per Mike's authorized ongoing scope
- **Revision reviewed:** `b9ab66c1fd5d08257e2545e95c362e7f98211b0a` (exact head) vs base `b2ffa7cf79b09ea9ee26f021058c4fd21c95d76d`
- **Worktree:** `/Users/man/worktrees/Fusion/300-hermes-cumulative-ledger` (read-only; not modified)
- **Scope authority:** `APPROVED-CORE-LEDGER-SCOPE.md` + `RUNTIME-BINDING-PROPOSAL.md` at `/Users/man/worktrees/agents/300-overlay-preflight/docs/plans/issue-300/hermes-budget-bridge-planning/`
- **Evidence mode:** fallback — exact source diff read in full, evidence logs decompressed and checksum-verified against `evidence/manifest.json` (all 8 entries match), no tests/builds executed by this review
- **Files changed (19, +300/-22):** `cli-token-usage-types.ts`, `index.ts`, `store.ts`, `cli-token-usage-ops.ts`, 2 test files, 1 changeset, PLAN.md/HANDOFF.md, `pg-run.mjs`, evidence blobs

## Verdict: **PASS**

## Scope compliance (D1–D4 of APPROVED-CORE-LEDGER-SCOPE.md)

- **D1 (compatibility union):** `CliTokenUsageWrite` kept structurally unchanged except an added `kind?: never` discriminant tag ([cli-token-usage-ops.ts:9](packages/core/src/task-store/cli-token-usage-ops.ts)); new `HermesTokenUsageWrite` bans `observations`/`identity`/`fresh`/`reaffirm` via `never` fields. Internal key is `hermes:<nativeSessionId>` (session key) + hardcoded `session-cumulative` (event key) — matches the required `hermes:<nativeSessionId>/session-cumulative` composite exactly ([cli-token-usage-ops.ts:65](packages/core/src/task-store/cli-token-usage-ops.ts)). No transcript fields or model identity reach Hermes: `HermesTokenCursor` types `bytes`/`fileIdentity`/`transcriptPath` as `never` and `validateHermesTokenCursor` runtime-rejects any extra key ([cli-token-usage-types.ts:9-23](packages/core/src/cli/cli-token-usage-types.ts)).
- **D2 (fenced verification, atomicity, no shadow totals):** Hermes writes go through the same `acquireTaskAdvisoryXactLock` + row `for("update")` + `task.checkout*` four-part ownership check as Codex/Claude, unconditionally ([cli-token-usage-ops.ts:70-76](packages/core/src/task-store/cli-token-usage-ops.ts)). `session.adapterId !== "hermes"` is checked against the real `cliSessions` row before any credit ([cli-token-usage-ops.ts:78](packages/core/src/task-store/cli-token-usage-ops.ts)). Rollback is explicitly refused (`Hermes cumulative counters regressed`, line 84-86) in addition to the generic `Math.max` reducer. `limits.hard` is required to be a positive safe integer for Hermes only ([cli-token-usage-ops.ts:59-60](packages/core/src/task-store/cli-token-usage-ops.ts)) — legacy `hard` stays optional, preserving D1. Ledger/credits/aggregate/hard-pause commit in the single existing transaction; no parallel/shadow structure was introduced.
- **D3 (RED-first, existing regressions green):** Verified directly from evidence, not just claimed:
  - `red.log` (checksum-verified): 5 failed / 9 passed (14) — the 9 passes are the pre-existing 7 legacy `it()` + `it.each(["claude-code","codex"])` (2) Codex/Claude tests, unmodified and green from the start.
  - `baseline-red.log`: 1 failed / 16 passed (17) — isolates exactly the "credits first failed observation rather than accepting a failure as historical baseline" case.
  - `final-pg.log`: 17/17 pass; `final-unit.log`: 5/5 pass (3 pre-existing + 2 new Hermes unit tests). Test count arithmetic checks out: 9 legacy + 8 new Hermes PG cases = 17.
  - No legacy PG or unit test was altered in a way that changes its assertions (diff confirms only additive test bodies).
- **D4 (verification breadth, no runtime claim):** `final-build.log` (core `tsc`) and `engine-typecheck.log` (`@fusion/engine tsc --noEmit`) both clean. The single non-test, non-core production consumer of these types, [token-usage-observer.ts](packages/engine/src/cli-agent/token-usage-observer.ts), was located by repo-wide grep and confirmed covered by that engine typecheck — it calls `recordCliTokenUsageFenced` with an object literal lacking `kind`, which still type-checks against the `CliTokenUsageWrite` arm. `lint.log`/`changeset.log` are 0 bytes (silent-success convention, consistent with other tooling in this repo) — see Note N1. HANDOFF.md's "no runtime budget acceptance" / "no host channel registration" disclaimers are accurate: nothing in the diff touches engine, plugin, or Hermes Python source.

## Correctness spot-checks (own analysis, not just evidence trust)

- **Baseline-once semantics:** `const baseline = request.baseline && !Object.hasOwn(ledger?.sessions ?? {}, key)` ([cli-token-usage-ops.ts:112](packages/core/src/task-store/cli-token-usage-ops.ts)) forces a second `baseline:true` call on an already-credited stream to fall through to normal delta crediting rather than re-zeroing — matches "later baselines cannot reset credits." Confirmed against `Hermes cumulative replay survives a fresh store...` test, which sends baseline twice and asserts the second yields a real +8 delta, not 0.
- **Failed-state absorption:** `previousCursor?.phase === "failed" && request.cursor.phase !== "failed"` throws unconditionally (both Hermes and legacy) — a stream that has failed can still receive further `phase:"failed"` writes and those still credit real deltas (verified: `Hermes failure credits partial actual increases...` test shows a 4→7 update while failed credits +3, and a duplicate resend of the same cumulative value correctly credits 0).
- **Baseline+failed guard:** `request.baseline && request.cursor.phase !== "baseline"` throws before any DB work when a caller tries to mark a `failed`-phase observation as a historical baseline — closes exactly the gap the second RED iteration was written to catch.
- **Concurrency:** two native Hermes sessions on the same task, run concurrently via `Promise.all`, are serialized by `store.withTaskLock` + the advisory lock, and the task-level aggregate (not per-stream) is what trips `hardExceeded`; test observes 10 then 20 with hard=20 and exactly one pause. This is the same trip semantics already used for Codex/Claude, correctly extended.
- **Overflow/idempotent retry:** overflow rejects before any row mutation (unchanged ledger/tokenUsage confirmed). The post-commit `writeTaskJsonFile` projection failure test proves the DB transaction had already committed by the time the JSON write threw, and a retried identical write correctly computes a zero-delta continuation rather than double-crediting — this is real idempotency evidence, not just a documentation claim.

## Notes (non-blocking)

- **N1 — thin evidence for two checks:** `lint.log.gz` and `changeset.log.gz` are both 0-byte captures, and `git diff --check` (listed as a verification command in HANDOFF.md) has no corresponding evidence file at all in `evidence/`. Checksums confirm the 0-byte files are exactly what's claimed, but empty output is consistent with either "silent success" (the repo's convention for these two tools) or "command didn't run/produced nothing to compare" — this review cannot distinguish the two from the artifact alone. Not a blocker: `final-build.log` and `engine-typecheck.log` are non-trivial, positive-content confirmations, and the diff itself is small and readable enough to manually confirm formatting/style by inspection, which I did.
- **N2 — narrow, untested state combination:** a Hermes write with `baseline:false` but `cursor.phase:"baseline"` is not rejected and not covered by any test. It would credit a real delta while persisting a cursor phase that says "baseline." This combination isn't forbidden by the approved contract's stated invariants and isn't a path any caller in this codebase currently produces (no host binding exists yet — Muse's slice), so it's a documentation/test-completeness gap rather than a correctness defect in what ships today.

## Explicit non-findings

- No fabricated transcript inode/offset or model-family attestation reaches the Hermes path (type-level `never` + runtime key-exhaustiveness both enforce this).
- No shadow totals: Hermes reuses `credits`/`sessions`/`cursors`/`owners`/task aggregate exactly as Codex/Claude do.
- No engine/plugin/Hermes source was touched; the only outside-core consumer (`token-usage-observer.ts`) was located and its typecheck is genuine (not self-reported without corroboration).
- This slice makes no runtime/host-registration/physical-request-coverage claim, consistent with `RUNTIME-BINDING-PROPOSAL.md` marking those as Muse-owned, separate, pending work — the diff does not overreach into that territory.

## Blockers

None.
