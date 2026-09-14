# Approved narrow Codex Git administration amendment

Evidence mode: exact source4800bcf80f6d825dbceacd2295d06e8ba2decd45 plus root-approved actual installed Git commit/denial report at /tmp/303-codex-permission-probe/git-boundary/REPORT.md. Separate branch preserves frozen4800 review.

## Scope

Codex-only helper cli-agent/codex-task-sandbox.ts derives actual native cwd/gitdir/common objects/current symbolic branch ref+lock+reflog using bounded async native Git reads. Reuse core resolveGitBinary and existing canonicalFuturePath. Existing Pi session-policy helper is insufficient: it follows the .git pointer and lacks exact common/ref/layout checks; do not change it. codex-app-server-session.ts consumes the derived paths and verifies exact effective set before identity. Existing settings remain closed/no path or argv bag. Tests: new real-local-Git derivation/refusal suite plus existing structured fake-child and accounting fixtures updated to express real native Git task worktree. Changeset and report only beyond these files.

## Invariants and tests first

Support standard linked-worktree loose-ref layout only; nonlinked layouts are explicitly refused. Linked gitdir must live immediately under common/worktrees and point back to the actual task .git file. Reject detached/unborn/unsupported storage layouts, unsafe symbolic refs, symlink substitutions/escapes. Native absolute paths and future lock paths must retain canonical existing-parent containment. Re-derive before native identity and refuse changed branch/admin binding. No shared .git directory, refs parent, packed-refs.lock or arbitrary caller roots are granted. Actual effective writable roots must equal the derived set (optional canonical task root is redundant), network false, both tmp exclusions, null profile; absent/widened/partial sets refuse.

RED: ordinary linked repository yields expected exact paths, detached/ref/backend/symlink/backpointer changes refuse; native peer observes roots and refuses widened/changed policy before identity. GREEN: minimal helper and integration. Keep selected full native task-session accounting regression and unselected behavior. Run scoped tests/typecheck/build/static/changeset/diff checks, freeze local commit for independent Claude review.

## Explicit tradeoff / limits

Policy becomes task worktree plus bounded native Git administration. Shared objects permission is ordinary filesystem write, NOT append-only or adversarial object-integrity protection. Existing linked admin directory permits native bookkeeping. Tested intent is ordinary loose-ref add+commit, not branch creation/rename, GC, packed-ref maintenance, rebase/push or arbitrary Git extensions. Author must still stage only implementation and commit before review; permissions do not create that commit. No model/runtime/DB/global config/push.

Root disposition: do not add Git awaits after existing final usageObserver.beforeFirstTurn ownership/budget ACK. Binding is identity-time; later branch changes never widen policy and may fail commit. An initially proposed extra first-turn rederivation was removed before freeze to preserve accounting ordering.
