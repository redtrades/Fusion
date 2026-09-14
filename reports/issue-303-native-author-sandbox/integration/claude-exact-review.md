# Issue 303 native author sandbox (Fusion) - independent review

**Verdict: PASS** (bounded scope below)

## Reviewer identity

- Model: Claude Sonnet 5 (`claude-sonnet-5`), Anthropic, via Claude Code desktop session
- Revision reviewed (head): `4800bcf80f6d825dbceacd2295d06e8ba2decd45`, branch `codex/303-native-author-sandbox`, worktree `/Users/man/worktrees/Fusion/303-native-author-sandbox` (confirmed via `git rev-parse HEAD`)
- Base: `7e55cf944123b1c7454eead3cc74ac8d3620ffbd` (direct parent)
- Scope: read-only static review of this one commit only. No source edits, no test execution, no model subcalls, no remote/network mutation, no writes outside this report. All commands run were read-only (`git diff/show/log`, `python3` hashing/decompression, `grep`).

## What was checked

1. **PLAN.md / HANDOFF.md / SHA256.json** read in full from `reports/issue-303-native-author-sandbox/`.
2. **Diff shape**: `git diff --stat` on the base/head pair - four production files (`adapters/codex.ts` +2, `session-manager.ts` +5, `task-session.ts` +4, `codex-app-server-session.ts` +25/-1), two test files, one changeset, and the evidence directory. Matches the PLAN's declared scope (no native-source expansion beyond the four seams named).
3. **Evidence integrity**: all 13 `SHA256.json` entries recomputed independently against the actual committed bytes (`.log.gz` files and the two markdown docs) - **exact match on every entry**.
4. **Log-content cross-checks against HANDOFF's specific claims**, not just the prose:
   - `final-tests.log.gz`: "Tests 40 passed (40)", 2 files - matches "40 PASS".
   - `accounting-regression.log.gz`: "Tests 16 passed (16)", 3 files - matches "16 PASS".
   - `red.log.gz`: "Tests 14 failed | 8 passed (22)" - matches "14 failures/8 existing passes"; failure text shows a genuine pre-fix assertion (`promise resolved "undefined" instead of rejecting` on an unsafe-policy case), not a fabricated log.
   - `routing-red.log.gz`: "Tests 4 failed | 7 passed (11)" - matches "4 failures/7 existing passes"; failure text shows the pre-fix generic-error message not yet matching `/sandbox/i`, consistent with "unsupported routing" being added later.
   - `static.log.gz`: "[static-gate] 16 validators passed" - matches "16 validators PASS".
   - `lint.log.gz`: "0 errors, 2 warnings" (the two warnings are the test files being ignore-pattern-excluded, not lint failures) - matches "zero errors... two test files are ignored... reported as warnings. Four production files linted."
   - `typecheck.log.gz`, `build.log.gz`, `changeset-check-final.log.gz`: all empty (silent success) - matches "exit0" for each.
5. **Core verification logic read in full** in `codex-app-server-session.ts`:
   - `verifySandbox()` runs immediately after the `thread/start` response arrives and strictly before the `thread.id` UUID check and before `onIdentity` is invoked - satisfies "before native identity callback/usage ACK/prompt, validate response."
   - Canonicalization: `cwd` is resolved via `realpath()` once up front (only when `codexSandbox` is set - ordinary launches are untouched), and every returned root (`runtimeWorkspaceRoots` and `policy.writableRoots`) is independently `realpath()`-resolved and compared against that canonical `cwd`. This defeats a symlink-aliased root that would otherwise string-match a different path than it resolves to - confirmed by reading the actual comparison, not assuming it.
   - Empty-or-same-root handling: the loop iterates `[...roots, ...policy.writableRoots]`; an empty `writableRoots` array contributes no iterations (trivially accepted, matching "observed [] is valid" from VERIFIED-DESIGN.md), while any populated entry must resolve to the same canonical root or the call throws. No entry is silently ignored.
   - Fail-closed unknowns: `policy.type !== "workspaceWrite"`, `policy.networkAccess !== false`, both tmp-exclusion booleans strictly checked, and `response.activePermissionProfile !== null` (strict inequality - an absent/undefined field or any named profile both throw, not just a mismatched one).
   - Pre-existing `realpath(thread.cwd) !== realpath(this.options.cwd)` cwd check (unmodified by this diff, confirmed via base-file diff) still runs afterward - the new check adds to, not replaces, existing verification.
   - `realpath` was already imported in the base file (`node:fs/promises`, line 4) - no dangling reference introduced.
6. **Selector containment at the three call sites**:
   - `session-manager.ts`'s new `spawn()` guard rejects when `codexSandbox` is set together with any of: non-`"task-worktree-write"` value, non-`codex` adapter, `!codexStructured`, `options.resume` truthy, missing `taskId`, or missing `worktreePath`. `options.resume` is a real, pre-existing field on `SpawnCliSessionOptions` (confirmed by reading its declaration and the pre-existing `buildResume` consumer at line ~459-467) - this is a genuine PTY/resume refusal, not a no-op check on a field nothing sets.
   - `task-session.ts`'s `launch()` guard requires `usageProtection` and `worktreePath` alongside the selector. `followUp()` (the actual resume/continuation path for a done task) returns `false` immediately when `this.usageObserver` is set (`// Protected continuation must enter a fresh admitted launch`), and sandboxed sessions require `usageProtection` truthy at launch - so a sandboxed session cannot silently continue via live-PTY follow-up; the caller must always route back through a fresh `launch()`, which re-validates. Traced, not assumed.
   - `adapters/codex.ts` only widens the typed `CodexLaunchSettings` interface with the single literal `"task-worktree-write"` - no open string/argument bag.
7. **Test coverage read in full**: `codex-structured-handshake.test.ts` contains `it.each([...16 modes...])("refuses unsafe author policy before identity and prompt: %s", ...)` covering symlink-escape, missing-writes, wrong-cwd, missing-policy, widened, wrong-runtime, missing-runtime, profile, missing-profile, dangerFullAccess, readOnly, externalSandbox, excludeTmpdirEnvVar, excludeSlashTmp, missing-tmp, network - a genuine one-to-one map against every branch of `verifySandbox`'s conjunction, not a handful of spot checks. The symlink-escape fixture explicitly creates a symlink to `tmpdir()` and asserts it is refused, directly exercising the realpath defense reviewed in step 5.

## Findings

No blocking findings. No informational findings beyond what HANDOFF.md itself already discloses (native git-administration outside the task worktree remains denied and is explicitly out of scope; the installed 0.154 no-turn/OS-denial probe at `/tmp/303-codex-permission-probe` is prior evidence, not a claim this patch re-validated it).

## Limits of this review

- Tests were **not re-executed** by this reviewer (out of scope). Pass/fail counts are corroborated by decompressing and reading the actual recorded vitest/eslint/tsc output, matched against independently recomputed SHA256 hashes of every evidence file - not by rerunning anything.
- This review does not evaluate the paired `agents/303-author-policy` compiler-side change (separate report: `303-author-policy-9771-exact-review.md`) or their end-to-end interaction; each was reviewed as its own bounded diff per the request.
- Host checkpoint/commit capability for the linked worktree is out of scope and not claimed solved here, consistent with HANDOFF.md's own statement that a separate root-owned probe is running.
- Does not constitute activation, merge, or pilot-configuration approval - HANDOFF.md itself states this is frozen for independent review only.

## Reproducibility

Every finding above is re-derivable from files committed at `4800bcf80f6d825dbceacd2295d06e8ba2decd45` in `/Users/man/worktrees/Fusion/303-native-author-sandbox`:
- `git diff 7e55cf944123b1c7454eead3cc74ac8d3620ffbd..4800bcf80f6d825dbceacd2295d06e8ba2decd45` for the full source diff
- `reports/issue-303-native-author-sandbox/SHA256.json` + sibling `.log.gz` files for hash/log verification
- `packages/engine/src/__tests__/codex-structured-handshake.test.ts` and `cli-codex-structured-pipeline.test.ts` for test coverage
