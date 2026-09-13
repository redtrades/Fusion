# WS 1.11 pilot handoff

Issue: [redtrades/agents#260](https://github.com/redtrades/agents/issues/260).
PR: [redtrades/Fusion#2](https://github.com/redtrades/Fusion/pull/2).
Branch: `ws111-watchdog-260`; base: `2fd2432092f9ba3092e5939f46ca6267295f08ed`.
Evidence mode: fallback evidence from current source, live issue, supplied
research, and runtime handoff. No full-recall or installed-runtime claim.

## Scope and placement

D1. Fusion is a Git repository and owns the graph executor/lease machinery.
The change therefore belongs in Fusion, with an opt-in source pilot entrypoint.
No agents governing files or live Fusion services were changed. The branch is
isolated and targets Fusion main through a PR; no direct base-branch push.

A1. Observe the bound agent child independently of the lease renewal timer.
Record lease freshness, process death and monotonic progress. Cancel graph
continuation and persist a terminal pilot attempt for lead attention.

A2. Preserve the failed attempt. A lead-approved manual successor has a new
identity/directory and an exclusive predecessor claim. No automatic restart.
See [the operational procedure](worker-stuck.md).

## Verified evidence

Verified implementation revision: `f630d79d78d1e5afff505c223c5f3501dd154312`.
The final handoff-only commit does not change runtime or test files.

- 15 targeted tests passed: dead/slow/unknown worker, lost exit event, expired
  lease, final progress drain, cancellation, persistence error, invalid poll,
  progress regression, bounded post-exit output, clean-exit drain, callback
  cleanup, spawn failure, real SIGKILL and manual resume/collision handling.
- 26 existing graph-handler tests passed.
- `pnpm --filter @fusion/engine typecheck`: exit 0.
- Scoped ESLint for the source pilot and CLI: exit 0. Test files are excluded
  by the repository ESLint configuration, not silently counted as linted.
- `pnpm test:gate`: exit 0; 448 engine-core, 203 core-unit and 72 CLI-shape
  tests passed. Its PostgreSQL lane skipped 10 tests without a configured server.
- `pnpm verify:fast`: exit 0, 21 steps green in 40.1 seconds, including
  source/CLI builds, scoped typechecks, and boot smoke (CLI help/init, real
  HTTP health 200 on an ephemeral port, clean shutdown).
- Separate documented CLI sequence: SIGKILL detected in **174.10 ms** against
  **3,000 ms** lease; fresh lease age **0 ms**, stdout progress **7 bytes**,
  progress age **103 ms**. Dead attempt exited 2 / `worker-stuck`; manually
  launched successor exited 0 / `completed`. Original state bytes preserved.
- Dead attempt `c5fed884-4085-43cf-bc3a-a82e45b1aa5b`; successor
  `1d89bee3-0787-4554-b022-ed05ad2e1631`. Both traversed `start`, `work` only.
  The dead attempt never traversed the authored `recover` failure edge.

## Negative evidence and limits

- The supplied KB-003 handoff reported failed acceptance despite its folder
  name. It was used as source context only. This change makes no claim that
  KB-003, WF-003, the dashboard, or its database is repaired or deployed.
- The first unit/integration runs failed because the new modules did not yet
  exist. After implementation, an assertion incorrectly expected terminal
  `end` in the graph's visited-node list. Source inspection confirmed `end`
  has handler-free semantics; the resume assertion now checks completion and
  actual successor output instead.
- Offline dependency installation lacked two Git-hosted packages. A normal
  frozen-lockfile install succeeded with scripts disabled; no dependency or
  lockfile changes were committed.
- `gh issue view` and metadata calls returned HTTP 401. The GitHub connector
  supplied current issue/PR data. HTTPS Git push lacked a username; SSH push
  to the same verified repository succeeded. No credential changes were made.
- Claude CLI reports unauthenticated. Different-model-family review is not
  satisfied. Supplemental GPT review cannot substitute for that gate.
- Production TaskStore/agent-runtime adapters are not wired. The real graph
  pilot intentionally simulates the lost worker-exit notification; it does
  not invoke a provider or claim a real model session was killed.
- No automatic restart, cross-host PID support, distributed fencing, or
  live-but-hung worker classification. No local-model inference was used.

## Supplemental review correction

The GPT reviewer found three important races on `459a44aab`: post-exit
output could keep resetting observation, exit 0 could be mistaken for death
before stdio close, and harness setup/callback errors could leak a child or
an ENOENT rejection. Four added regressions reproduced all findings (4 failed,
11 passed, one unhandled rejection). The corrections cap post-death progress
grace, separate clean exit from bounded output drain, and place setup/run
inside the spawning harness's error cleanup boundary. The observer itself
still cannot kill or restart. All 15 targeted tests now pass.

The source/CLI build passed. Boot initially failed because the dependency
install skipped embedded PostgreSQL's symlink hydration. `pnpm rebuild` did
not hydrate this package in the workspace; running its declared
`postinstall` script in its package directory did. PostgreSQL version
inspection then succeeded and `pnpm smoke:boot` passed: CLI help/init,
HTTP 200 on an ephemeral port, clean shutdown. No live service was touched.

## Remaining review state

Draft PR, unmerged. Corrected implementation is pushed and verification
passes as recorded above. Supplemental exact-revision re-review is pending;
its final disposition will be recorded in the PR. The lead owns the required
different-model-family review and any later installed-runtime promotion.
