# Atomic terminal suspension — bounded plan

Evidence mode: fallback, existing source plus actual PostgreSQL regression. Base 03e92a64769cd699a6a14421290a4d6e0ec3ecc5. Isolated worktree /Users/man/worktrees/Fusion/300-terminal-suspension. Owner spec_review; other workers retain overlay/WS16/engine integration.

1. Reproduce legal same-column A4 commit without native paused/status/reason using actual PostgreSQL. Exercise actual resumeTaskForAgent against the persisted row to show redispatch.
2. Locate existing explicit release API and test whether it preserves current lease/row fencing and checkpoint continuation. Do not invent a release protocol.
3. Only if safe release can use an existing seam, project paused/status/pausedReason/error inside moves.ts's existing workflowOverlayTerminal transaction, alongside the terminal receipt. Keep exact replay, rollback, Reset supersession and lifecycle policy. No WIP-to-hold move or new taxonomy.
4. Otherwise stop at failing regression + precise release gap as instructed, retain source unmodified, and return the minimum integration decision needed.

Intended production scope: packages/core/src/task-store/moves.ts only; targeted existing PostgreSQL A4 and native resume tests. Derive/use existing caller terminal reason, never silently label paused status as named-column WS16 acceptance.

Release source finding: pauseTaskImpl in branch-group-ops.ts:280–367 clears pause flags but does not fence against the A4 terminal receipt, compare lease epoch/node, or advance/retire its checkpoint. A4 replay in moves.ts:68–76 rejects any changed row xmin. Ordinary unpause therefore cannot be represented as exact terminal replay or proven checkpoint continuation. Reset is a different explicit lifecycle operation, not equivalent to resume from this checkpoint.

## Authorized staging clarification

Parent explicitly authorized containment-only commit after the failing reproduction. Release remains open, not a prerequisite falsely claimed as completed. Implement existing paused/status/reason/error projection in the A4 transaction, no userPaused fiction or worker-linked pause. Validate production terminalBlock receipt spelling and retain legacy terminal receipt support. Preserve exact replay and Reset behavior.
