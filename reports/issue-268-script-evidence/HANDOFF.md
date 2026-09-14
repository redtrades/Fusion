# A1 named-script evidence handoff

Evidence mode: fallback source and executable tests. Base a18f9d1370dfcbdf4ec57b6331ff457995075b5a; isolated branch codex/268-script-evidence. Approved scope is in SCOPE.md; A2 remains outside this commit. No shared checkout, live DB/service, credentials, inference, public push or task mutation.

## Result

Native named-script success now retains bounded stdout/stderr and exit0 evidence; native failure errors reach graph output. Script execution success is retained separately from advisory traversal success, so a tolerated failing command is recorded failed without altering routing. Ordinary scripts receive source:node records, and foreach scripts use materialized identities consistently through pending/finish/discard. Optional-group children remain unrecorded individually. Normal terminal logs are best-effort, emitted only after acknowledged result persistence; a synchronous log failure cannot replay the command. No review metadata is manufactured.

## Verification

- RED: 4 initial tests fail for lost actual printf output/bounds and absent top-level/foreach records (red.log).
- Additional RED: advisory failure wrongly recorded passed and throwing log replay/escape (advisory-red.log).
- Final scoped suite: **76 passed, 0 failed, 0 skipped across 3 files**; workflow-script-evidence, workflow-graph-foreach, workflow-graph-optional-group (final-tests.log). Includes actual harmless native configured commands, two distinct instance IDs, cancellation/discard identity, missing script, failed/advisory outcome, skipped evidence, non-ACK sink, throwing log, optional-group exclusion. No model process is selected by these tests.
- Core and engine builds PASS (core-build.log, engine-build.log). Scoped production ESLint PASS; new test file is excluded by repo lint configuration (warning retained in lint.log), not claimed linted. git diff --check PASS.
- Dependencies installed with pnpm install --frozen-lockfile --ignore-scripts in this worktree. No boot smoke or installation-runtime proof claimed.

## Negative evidence and limits

The first changeset check used a nonexistent script filename (MODULE_NOT_FOUND); reran the supported pnpm check:changesets successfully, preserving both logs. Initial GREEN attempt exposed an undefined context-key import; corrected to the existing reserved foreach context key and reran. Existing durability sink remains fail-soft: an unavailable persistence sink can leave no result; graph success alone is not acceptance. Host log sink is fire-and-forget and not a durable ACK. Result-sink tests exercise the executor contract with synthetic receipt callbacks; this work did not run a real DB or establish runtime KB-003 acceptance. No new crash/lease fencing guarantee is claimed. Existing native sink fencing is reused.

A2 task-step completion, live KB-003 reopening, code-node normalization, review/merge gates and deployment remain open. Parent owns independent Grok CLI review on the frozen commit; no independent source review yet at this handoff.
