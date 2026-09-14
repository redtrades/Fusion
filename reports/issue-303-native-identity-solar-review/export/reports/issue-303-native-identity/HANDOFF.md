# Native observed identity handoff

Evidence mode: source, deterministic synthetic peers and isolated PostgreSQL.
Base: 379c94d5e7c3bb824baf9b5c3705781904848c36.
Worktree: /Users/man/worktrees/Fusion/303-native-identity-binding.
Branch: codex/303-native-identity-binding. No source overlap with step/merge work.

## Delivered

Codex returned selected model/provider is carried through its existing handshake
and manager admission. Native turn-context model plus session-header provider
corroborates that selection. Claude reads actual assistant-message model with
usage, without inventing transport provider. The existing native fenced usage
ledger stores this evidence; exact-session accounting exposes it only with a
drained cursor, actual observed model and complete post-baseline coverage.

Missing identity remains compatible with manual/legacy accounting. Missing or
partial models downgrade coverage to incomplete; it never upgrades within the
stream. Repeated baseline of an already-owned identity also downgrades coverage
and hydrates prior evidence through the existing transaction acknowledgement.
It cannot borrow an earlier drained review's eligibility.

Known model/provider mismatch on a trusted native stream collects valid usage
through the existing bounded read batch, persists credits with failed cursor,
preserves prior identity, then stops the session. Wrong native session/inode/cwd
or lease does not receive attribution. Failed cursors cannot return to live
phases; identical failed replay is idempotent. No parallel store or service.

## Verification

- Initial observer RED: 5 failures. Missing/partial/baseline identity was absent;
  Claude and Codex mismatches did not stop/mark failure.
- Initial PG RED: 2 failures/5 passes (identity missing, failed cursor revived).
- Capability RED: 1 failure/2 passes (complete identity not exposed).
- Additional provided-cwd RED: 1 failure/8 passes, then corrected.
- Partial Codex provider RED: 1 failure/9 passes; corrected to preserve earlier
  observed evidence while downgrading coverage instead of dropping usage.
- Final engine: 39 passes across observer, parser, manager/budget pipeline,
  structured handshake and exact-session capability suites.
- Final isolated PG: 9 passes, including actual observer batches for both native
  adapters, charge-once failed replay, incomplete-baseline hydration, unchanged
  Reset/lease/native identity fences and rollback on conflicting identity.
- Core ledger unit tests and core/engine builds are checked separately below.

Logs: /tmp/303-identity-red.log, /tmp/303-identity-pg-red2.log,
/tmp/303-identity-capability-red.log, /tmp/303-identity-cwd-red.log,
/tmp/303-identity-partial-red.log, /tmp/303-identity-final-engine.log,
/tmp/303-identity-final-pg.log, /tmp/303-identity-ledger-test.log,
/tmp/303-identity-lint.log.

Dependencies installed offline in this worktree. Initial embedded PG launch
failed because the ignored postinstall left native dylib links absent; invoking
the package's own hydrate-symlinks script in its package directory fixed this.
The first invocation from worktree root was ineffective and recorded as a setup
failure. Test PG used a new disposable data directory and ephemeral loopback
port; the runner stopped that owned server in finally. No live database touched.

## Negative evidence and limits

Codex turn-context is native execution selection evidence, not provider-response
model disclosure. Claude message model is actual response model evidence, not
transport provider identity. No provider is inferred from model names. The
accounting receipt exposes identity evidence, not a merge-authority Boolean;
overlay automatic policy and different-family classification remain separate.
Failed/incomplete sessions retain actual phase and committed workTokens, but
expose no eligible identity. Spend emitted after the bounded failure batch and
stop may be unknown; it is not reported as zero or fully accounted.

No actual CLI/model inference, auth/config change, deployment, merge, push or
automatic-mode enablement. Exact-source independent review remains root-owned.

Final ancillary verification: 3 core ledger unit tests passed (51 total tests
including the 39 engine and 9 PG tests). Core and engine builds passed. ESLint
on changed production modules passed. Changeset format and git diff whitespace
checks passed. No full application boot, UI check or full-suite claim.
