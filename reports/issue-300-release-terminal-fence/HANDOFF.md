# Release fence retirement handoff

Evidence mode: fallback, current source and actual isolated PostgreSQL execution.
Base: abd4816e74eba665f7a5e3dbbb97d1ec73b14f25.
Worktree: /Users/man/worktrees/Fusion/300-release-terminal-fence.
Branch: codex/300-release-terminal-fence. Parent owns integration and independent review.

## Change and verified behavior

Successful held-terminal release now verifies that the checkpoint run, final receipt
index, write operation, expected phase count and terminal target match the held
anchor. The existing transaction removes only checkpoint.writeFence.terminal when
publishing the successor and clearing pause. Other fence fields, complete receipts,
phase/occurrence/envelope/head state and currentTerminal release lineage remain.
Released-operation retries retain the existing separate branch and active-successor
validation. No schemas, lease/actor endpoints, A4 replay policy or native columns changed.

The actual last-slot use case is a released checkpoint at phase 255. A fresh A4 can
now append its capacity hold at phase 256 without an A3 marker. The original request
remains refused with transition-superseded even when presented with current admission:
prepareWorkflowOverlayStateWrite recognizes the exact old operation/state replay,
and moves.ts rejects prepared.replayed. A stale admission refuses before fresh apply.

Capacity correction: the native check sums the EXISTING namespace before append.
254 to 255 through A3 and 255 to 256 through A4 both succeed, including before this
fix. A request starting at phase 256 refuses; a new graph append at namespace total
256 also refuses. Earlier claims that 254 had only one native slot were inaccurate.
No cap change was made.

## Verification

- RED before source changes: 5 failures / 9 passes in release suite. Fresh A4 after
  release refused at both phase 254 and 255. Three mismatched checkpoint/anchor
  bindings incorrectly released. The A3 254 to A4 256 boundary test already passed.
- GREEN: 39 actual PostgreSQL core tests across release, terminal and state fencing;
  10 actual PostgreSQL engine tests across released-principal and outer-failure paths.
- Release tests include both Reset race orderings, current lease/stale lease refusal,
  exact replay, immutable history, transaction rollback and postcommit projection retry.
  The rollback test now also compares the complete unchanged sourceMetadata.
- Core TypeScript build passed. Scoped production ESLint passed; the repository
  ignores the test file for lint (reported warning, not a test-lint claim).
- Changeset check and git diff --check passed.

Logs: /tmp/fusion300-release-fence-red.log, /tmp/fusion300-release-fence-green.log,
/tmp/fusion300-release-fence-full-pg.log, /tmp/fusion300-release-fence-core-build.log,
/tmp/fusion300-release-fence-lint.log, /tmp/fusion300-release-fence-changesets.log.
Runner: /tmp/fusion300-release-fence-pg-run.mjs, ephemeral local PostgreSQL stopped
in finally. Shared live databases were not accessed. Source dependencies reused
integration node_modules through this isolated tree's links; no shared edits.

## Boundaries and negative evidence

The initial metadata assertion showed the retained fence before reaching fresh A4;
it was moved so RED exercised the public A4 refusal itself. The fixture seeds long
valid history through task metadata, then executes the actual A4/release/A3 stores
against PostgreSQL; no inference, fake runtime or production marker is involved.
The inherited scratch PostgreSQL runner exited zero even when Vitest reported RED;
the test summaries and actual Vitest failure are the evidence, not its wrapper exit.
The final run contains only passing suites and stopped its owned PostgreSQL child.

No public push, local inference, paid provider, live service, review approval or full
pilot claim. Exact-revision different-family review remains parent-owned. Overlay
released-receipt consumption and CLI accounting remain other workers' scopes.

## Coordinator independent review

Exact dda26100c7ac27ad426d77f89d923b3fbed659b4 received supplied-source PASS from actual nous/upstage/solar-pro4:free through Hermes, 2 API calls, 11,661 total tokens, estimated USD 0. Raw verdict and native usage are adjacent. Author family was OpenAI. Review findings are positive source observations, not reviewer runtime executions. Integrated locally as 8c7250cba.

Coordinator final composition8c7250cba: all49 actualPG tests passed (39core,10engine), owned database stopped; corebuild passed, no source changes afterward. Logs /tmp/fusion300-release-fence-coordinator-pg.log and /tmp/fusion300-release-fence-coordinator-core-build.log. The root runner propagates child failure status; passing counts are separately verified. No fullpilot or publicdeployment claim.
