# Main Board terminal display handoff

Implementation owner: OpenAI, subordinate to root's issue #300 claim.
Evidence mode: current source and executed deterministic checks (fallback evidence).
Branch: codex/300-terminal-board. Worktree: /Users/man/worktrees/Fusion/300-terminal-board.
Base: 0a9db6215. Native dependency f5bf2d043e423bd34cc734a98bd8cbfe684c6d7b
cherry-picked unchanged as a89464e65. No native release files were edited here.

## Delivered scope

Exactly the ten source/test files in the approved main-Board design, plus this
report/fixture/screenshots and one changeset. API-only terminalDisplay is derived
from the native transactional current-held reader. The adapter maps the accepted
WS16 reasons and rejects unknown reasons or contradictory resume actors. It
limits concurrency to eight paused-row reads, with no historical-anchor inference.
A changed task ID/revision/phase between list and validated read omits projection.
The native reader checks workflow IR/current held anchor. It does not expose a
workflow UUID, so the summary carries its actual anchor and graph run identifiers.

Selected and aggregate main Board render separate read-only Blocked/Escalated
lanes. Native task.column, workflow columns, move targets, original Task references
and allTasks capacity input stay intact. The only tile action is Open details.
Paused state, actual phase, reason, actor and task ID are visible. There is no
Resume control, fake externalBlock, native column change or new plugin SPI.

Cache restore, full-snapshot omission, accepted SSE, Reset and reconnect remove
transient evidence. Paused updates coalesce a canonical refresh; one queued read
handles an event racing that read and cannot run after unmount/project change.

## Verification and negative evidence

- Three targeted Vitest files: **114 passed**, exit 0 (final bounded run).
  Includes both Board modes, native WIP input, identity/action isolation, stale
  REST after Reset, cache hydration, live SSE enrichment, queued refresh/unmount,
  and native-reader refusal/mismatch/unknown reason.
- Initial red: missing Board lanes and stale snapshot retention (3 failed),
  unenriched native hold (1 failed), missing live SSE refresh (1 failed), and
  queued refresh after unmount (1 failed). All fixed without weakening assertions.
- Dashboard server/app and core typechecks: exit 0. Scoped ESLint: exit 0.
- Vitest logs emit React act and jsdom canvas warnings, with no failed tests.
  No claim is made that the broader suite is warning-free.
- Real Chromium fixture uses actual Board/Column/TerminalDisplayColumn with
  synthetic API responses, never a live database/task. Desktop and mobile images
  were inspected. After fixture Reset, browser-receipt.txt confirms terminalCount
  zero and cards in their original implementation/review phases. This proves
  display behavior, not native admission/release or real-model pilot acceptance.
- Initial preview attempts failed because generated locale assets were absent,
  the report fixture lacked package dependency resolution, and an @fs HTML page
  lacked Vite's React preamble. Generated locales, a temporary local node_modules
  link and the fixture preamble resolved these. Synthetic API default responses
  also needed arrays. These were fixture failures, not production fallbacks.
- Native store/authorization/Reset correctness is dependency-owned. No live DB,
  model call, public push, merge or independent-review approval happened here.

## Commands / remaining gates

From the worktree: `pnpm install --offline --frozen-lockfile --ignore-scripts`.
Run the three tests with `FUSION_DASHBOARD_DEEP=1 pnpm --filter @fusion/dashboard
exec vitest run --project dashboard-app --project dashboard-api` plus
`app/components/__tests__/Board.test.tsx`,
`app/hooks/__tests__/useTasks-stale-hydration.test.ts`, and
`src/routes/__tests__/task-terminal-display.test.ts`.
Run `pnpm --filter @fusion/dashboard typecheck` and
`pnpm exec tsc --noEmit -p packages/core/tsconfig.json`.

Visual fixture: generate locales with dashboard `gen:locales`, create temporary
`reports/issue-300-terminal-board/node_modules` link to
`../../packages/dashboard/node_modules`, run dashboard Vite bound to loopback on
an unused port (not 4040), then open its @fs path to this report's preview.html.
`window.resetTerminalFixture()` applies the display-reset fixture. The capture
script used was /tmp/300-board-capture.mjs; PNGs and DOM receipt are retained here.
The temporary dependency link was removed; it is not part of the commit.
The isolated Vite/Chromium processes were stopped after evidence capture.

## Header count distinction

The original Column header means executing / displayed cards, not native capacity.
The paused task already contributes zero to executing; projection changes its old
lane denominator from one visible card to zero. Thus 0/0 does not assert free
capacity. A real comparator test calls the existing isRunningAgentTask predicate
and groupByWorktree helper before/after projection: executing remains one for a
mixed running+paused fixture, actual WIP membership remains two, and Up Next stays
capped at the same one task. Both Board-mode tests retain the original paused WIP
task in the allTasks input. No engine admission or pause-counting policy changed.

Root owns exact-revision different-family review, integration, broader build/gate
checks and eventual live acceptance. This local implementation is not its own
independent review, a native resume authorization UI, or a full #300 closure.

## Follow-up: durable disposition integration correction

Root found a producer/consumer mismatch before independent review of 98d7409f1.
Verified the agents writer at f329db5532ef43c2664214367b73f1c04ff586f8,
`tools/procedure-engine/live/terminal-binding.mjs:23–24`: it removes the input
operatorColumn and persists terminalBlock.disposition. The first Board revision
incorrectly required the removed field for operator-hold and therefore omitted
those real held tasks from display. Earlier fixture checks did not cover that
producer shape; they were insufficient for this branch.

The adapter now consumes blocked/escalated disposition for operator-hold, checks
its resumeActor, and rejects explicit dispositions contradicting other known
reasons. Known older reasons without disposition retain their unambiguous mapping;
operator-hold without valid disposition is refused. No writer/native changes.

Regression: exact persisted operator-hold shapes for both dispositions, wrong
actor, unknown/missing disposition, and contradictory non-operator reason pairs.
Before fix: 4 failed / 6 passed. After fix: all 10 adapter tests pass. Narrow ESLint,
dashboard server typecheck and whitespace checks pass. Original 98d7409f1 remains
an immutable review boundary; this correction is a separate local commit.
