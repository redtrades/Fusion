# Release terminal fence retirement

Evidence: current source at abd4816e74eba665f7a5e3dbbb97d1ec73b14f25 and isolated PostgreSQL tests. Parent authorized this bounded design and the public TaskStore release/A4 test seam.

1. Extend the existing actual PostgreSQL release suite: namespace totals 254 and 255, release the current terminal, refuse old terminal replay, append a fresh capacity hold. Verify the actual final slot and 254→255→256 boundary rather than assuming the cap rejects 256. Prove immutable checkpoint history, other write-fence fields and released-anchor lineage survive release; stale admission, Reset and rollback remain refused/atomic.
2. Validate graph, final receipt index, operation ID and expected phase count against the held terminal checkpoint. In the already successful release transaction, delete only that checkpoint's writeFence.terminal. No A3 marker, schema, lease, actor, generic replay or policy changes.
3. Run the regression RED, implement the narrow deletion and binding check, rerun release/state/terminal and released-principal PostgreSQL suites plus outer tests where available; build core and check scoped lint/diff. Record evidence and freeze a local commit for parent-owned different-family review. No push, inference or live database.

Scope: packages/core/src/task-store/workflow-overlay-release.ts; packages/core/src/__tests__/postgres/workflow-overlay-release.pg.test.ts; one changeset; this task-local plan/handoff. Existing A4 rejects prepareWorkflowOverlayStateWrite replay in moves.ts even after terminal-specific fence removal; verify behavior, not only metadata.
