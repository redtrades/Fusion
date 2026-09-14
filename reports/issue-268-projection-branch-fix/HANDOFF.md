# A2 conditional script completion follow-up

Parent: e582139d5c352ad8fd52b7fcb27d658f1be09bc4, preserved immutable. Worktree: /Users/man/worktrees/Fusion/268-projection-branch-fix. Evidence mode fallback: committed source, native IR parser/walker, isolated tests.

## Outcome and scope

Native validator accepts a shared sequential blocking-script diamond. Prior A2 verified the selected path but then required every template node, refusing completion solely for an unselected sibling. Remove that cardinality requirement. Every executed script must still be successful, scriptSucceeded true, not skipped, and not cancelled; native fenced complete must accept before instance completion. Keep existing chooseNextEdge termination semantics exactly. No additional structural-exit restriction or framework policy is introduced.

Production diff is three removals/two replacement lines in workflow-graph-foreach.ts; core fencing is unchanged. Tests validate the full IR (including required parse-steps predecessor) then run the existing native runForeach. Successful diamond runs start/select/left/finish/done/completed, never right. Selected failure, unverified success (including advisory-like normalization), skipped, and cancelled results never call complete.

## Verification

- RED: 1 failed, 14 passed; accepted diamond success was the sole failure (red-test.log).
- GREEN engine: 91 passed, 4 files, zero skipped/failures (green-engine.log). Includes existing linear, refusal, review/worktree exclusions, foreach, script evidence, optional group coverage.
- Actual isolated PostgreSQL: 40 passed, 4 files, zero skipped/failures (pg-green.log). Preserves Reset/replan/release/plan snapshot/task mutation fencing regressions. Child and outer exits both 0; owned ephemeral PostgreSQL stopped; no matching unique database process remained.
- Production ESLint, changeset format, diff check passed. Fresh engine build passed (engine-build.log, pnpm exit 0). Core source unchanged; core build not repeated for this engine-only delta.

## Negative evidence and review boundary

Initial scratch graph omitted mandatory parse-steps predecessor: native validator rejected fixture before traversal. Corrected fixture, then accepted-IR reproduction confirmed regression. First repo test command referenced absent root vitest binary (red.log); corrected to existing engine package executable, then observed behavioral RED.

Root's independent Hermes/Solar review on exact e582 reported PASS but missed this branch bug (raw evidence remains /tmp/268-a2-review). That is not acceptance of the corrected source; new revision requires independent re-review. No source PASS, live runtime acceptance, task/DB production mutation, public push, inference, or deployment claim. Original all-source task ownership limits remain: current tuple + plan snapshot, not identical-plan ABA.

Scratch original report proposed a structural-exit guard; final root-approved scope explicitly preserves native traversal exit semantics instead. This rejected alternative is retained as negative evidence, not implemented.

Final staging found trailing blank lines in two text logs. Removed only trailing blank lines and rechecked staged diff before freezing; test results are unchanged.
