# Issue 268 current integration reconciliation

Evidence mode: fallback evidence from current Git objects, GitHub issue/comments, and the existing local handoff. Read-only inspection on 2026-09-14. No verifier, database, live runtime, inference, authentication, task, or lock operation was performed.

## Conclusion

F1. The Reset physical-path fix is already committed in shared Fusion at `a889f0c0b8c4782619b7ed663bdc7503b6854d21`, directly on `2fd2432092f9ba3092e5939f46ca6267295f08ed`. It is absent from the inspected integration revision `a83b0e29218c55f35d87fe4b7b745d037b09f51e`. The shared tree has no tracked modifications; its only untracked paths are `reports/KB-003-full-green-20260913/` and `reports/issue-268-20260913/`. The handoff and latest issue comment still saying “uncommitted” are stale. This is an integration/review boundary, not a need to repeat diagnosis or recreate the patch.

F2. Current GitHub issue 268 remains OPEN. Latest inspected comment is https://github.com/redtrades/agents/issues/268#issuecomment-5657675884. Its different-family review gate remains unrecorded. Historical hosted gpt-5.6-sol approval does not establish that gate. Neither the local commit nor this inspection proves deployment or live KB-003 acceptance.

F3. The previously recorded atomic WS16 prerequisite is now substantially implemented in the scoped native #300 APIs. It should be reconciled to those APIs, not expanded into an arbitrary metadata patch API. Generic deterministic-node progress and actual KB-003 Reset/rerun evidence remain separate outstanding work.

## Exact source boundary

Reset commit: `a889f0c0b8c4782619b7ed663bdc7503b6854d21` (`fix: Reset/worktree physical path identity via canonicalization (#268)`). Ten files, 161 insertions and 45 deletions. SHA-256 of current `git diff 2fd2432092f9ba3092e5939f46ca6267295f08ed a889f0c0b8c4782619b7ed663bdc7503b6854d21` bytes: `21f64fa02d875fc0a334dd01a6aea3fa4d0443f56a6cb6c439f16b5e49fc8b9f`. The historical report's scoped diff SHA-256 is `658bb34de522114fbfe59a6896293f848bfba5b69618162a341f1ed70efc67b5`; diff byte hashes depend on command/format and are not substituted for the immutable commit scope.

Integration changed from `33d092197e58a64c72fd810dabf1bf157df13c05` to `a83b0e29218c55f35d87fe4b7b745d037b09f51e` during this read-only task. The table and ancestry check are pinned to the latter. Reset commit is not its ancestor. The missing changeset and seven existing scoped files identical to base establish that the fix was not independently applied under another SHA. The only scoped files with independent integration changes are `core/src/index.ts` (CLI token exports) and `register-task-workflow-routes.ts` (Board terminal display enrichment). Their inspected hunks are separate from the Reset changes.

The source fix introduces `canonicalizeWorktreePathSync` in `packages/core/src/tasks/worktree-path-reservation.ts:44`, using physical existing-path identity or nearest existing ancestor for absent leaves. `canonicalizeWorktreePath` delegates to it. Reset target planning uses it for target deduplication, singular fallback and alias matching. The dashboard uses the same identity for repository registration keys and containment, and retains raw recorded-session alias liveness checks before removal. Engine `worktree-pool.ts:68` delegates its existing physical canonicalizer to this shared helper. Integration still has lexical `resolve` in core Reset planning/reservations and the older separate engine helper.

Committed blob SHA-256 values (missing means no file):

| File | Reset commit | Integration |
|---|---|---|
| `.changeset/reset-worktree-physical-identity.md` | `9f3e1d6995067964d36ebda308b6dbf4c855098019f13f3a2ad34517f93a569c` | `missing` |
| `packages/core/src/__tests__/task-reset-targets.test.ts` | `3803eb1bd83c795ee9ba5353e09d63e20fca885eeea8bac9fe24a8c1441fd3d0` | `c85f2681d523f096636be5f2309c4ae8003d0935532fd5d2b474d3835eb91e0e` |
| `packages/core/src/__tests__/worktree-path-reservation.test.ts` | `5329881030aa49d99cab6c5dcd3d73639b0412190bee5ef6ae76a1e79452b654` | `937ed6ed54041ffe3af0d3ffcb32ae984c6bf6478342410e0db660779a529e2f` |
| `packages/core/src/index.ts` | `d0997d2341b4068fd98b71182828901d2eae8882304c6080699b08a4e70049ca` | `35798028cc81c5a955ef78c1c91dd675ea3c7219facdb865c88738ffbd7d9637` |
| `packages/core/src/tasks/task-reset-targets.ts` | `5d1f83046199b9b8bbe04ba7848d0c4d7552e66c5ac150dba023081d00408524` | `a3567646d1be005c2c3d8fbfed197427c6b8f82600fe9c210a42948c88bb0088` |
| `packages/core/src/tasks/worktree-path-reservation.ts` | `461dc9f5ac86a72bcb0507214c1a48add4fc3645bc1e68207c5992989760b013` | `0d8a9a1ae6c44dfdf67c7159083029653b3dd68cff861b2d775079766a5205e2` |
| `packages/dashboard/src/__tests__/task-reset-lifecycle.test.ts` | `19b794bd09191920da6bf0b1d2ea1b1438fd59056246b5b0132c477181f34e09` | `b362c45fb9b497b2a63d65df0b322f81b70e87445d5c4d9153389fb973de21c8` |
| `packages/dashboard/src/__tests__/task-reset-workspace-lifecycle.test.ts` | `e0f9c772e9e2b778022ae24fd2560ef90c89634bd46e5713e2d18e24f102d3ab` | `9f1309352b53de714c8c67663f2ba1f941332fb22bc3ef51d70cd92d7c86ba06` |
| `packages/dashboard/src/routes/register-task-workflow-routes.ts` | `88299ca180f7a41d74f955cbc1fd5d9c333424413824a018debb3217efebb757` | `d6e742df0266f742adfa7c3fa25e442a3cb42b2c5758844d204d84426d165c73` |
| `packages/engine/src/worktree/worktree-pool.ts` | `eee55320dfdc4d1087735e1087b1a9fb674b258d7da53ec576ddc0160ae6562d` | `e82cfee7b6b1f10435c508b84d0fbf5d86d83fa97fbe32e890f93d6466b21e1d` |

## Existing atomic and current-terminal bindings

All paths below are relative to the pinned integration tree.

- A3: `packages/core/src/store.ts:2267` exposes `updateWorkflowOverlayStateFenced`; its types and implementation are in `packages/core/src/task-store/task-mutation-ops.ts:398`. It owns bounded JSON under `sourceMetadata.procedureEngineLive.runs[graphRunId]`, validates native checkout run/lease epoch/agent/host ownership, and uses the native Reset advisory transaction lock plus task row lock. `expectedPhaseCount` and operation identity provide append-only CAS and idempotency while preserving other metadata. Limits are 256 phases across the namespace and 1 MiB. This is `sourceMetadata`, not arbitrary `task.metadata`.
- A4: `packages/core/src/store.ts:2262` exposes `applyWorkflowOverlayTerminalFenced`; `packages/core/src/task-store/moves.ts:46` accepts expected/target column plus the A3 state write. It validates exact current row/admission and delegates both terminal metadata and column/lifecycle effects to existing `moveTaskInternal`. Native move policy remains authoritative. Same-column WS16 suspension persists paused status/reason and clears automatic agent-unpause ownership. Exact retry is conditional on unchanged durable row identity in the bounded full-XID/xmin window, not a permanent promise across intervening updates or Reset.
- Current held state and release: `packages/core/src/task-store/workflow-overlay-release.ts:87` publishes a deterministic native successor before clearing pause, in one Reset-fenced transaction. It checks current terminal operation, graph, current checkout ownership, selected custom IR and actual top-level blocking node/held work item. It retires only the matching old terminal fence so a subsequent terminal hold can persist. `readWorkflowOverlayCurrentTerminalImpl` at line 173 verifies actual held work item, current IR, task pause and durable reason; historical receipts alone never establish current hold. Release is a trusted store primitive: an actor string is not user authorization.
- Board: `packages/dashboard/src/routes/task-terminal-display.ts:4` calls that authoritative read-only validator. `register-task-workflow-routes.ts:1523` and `:4931` enrich list/detail responses. These are the integration hunks to retain when incorporating Reset. No latest-historical-run selection is needed.

These APIs meet the concrete scoped atomic terminal-state/policy requirement. They do not add generic PATCH metadata support, prove an authenticated release endpoint, solve all nested restart behavior, or persist generic deterministic-node step progress automatically.

## Historical validation and negative evidence

`/Users/man/Fusion/reports/issue-268-20260913/RESUMED.md` records 21 core, 46 engine and 44 dashboard focused passes; gate 723 pass/10 skipped; verify:fast 19 steps; and a built extracted ownership probe. These are historical claims, not rerun here and not a live Reset proof. It records installed and built bundle hashes as different and explicitly leaves deployment unchanged. No current runtime hash or health was read in this task.

The latest issue evidence reports KB-003 selected WF-003 with two pending steps, zero results/logs/WF-003 instances and two historical WF-002 instances. Those are dated observations, not fresh counts. Remaining deterministic result/log and graph-owned step-completion work must be assessed independently before supported live Reset/rerun and verifier acceptance. No raw stored task patch, lock removal, direct column SQL or simulated success is recommended.

## Minimal next boundary

A1. Use already-frozen `a889f0c0b8c4782619b7ed663bdc7503b6854d21` and its exact ten-file diff for the required different-family review; retain the historical test evidence with its limitations. There is no outstanding shared tracked patch to freeze.

A2. After review disposition, integrate that commit into the isolated #300 composition, preserving the independent CLI exports and Board list/detail enrichment. Rerun the relevant Reset/reservation/workspace suites and composition checks on that resulting exact revision. This report has not cherry-picked or run those checks.

A3. Record the corrected committed-but-not-integrated/deployed state and the scoped A3/A4 mapping in issue 268. Separately keep the deterministic-node/KB-003 acceptance gate open. Any later deployment must respect the handoff's old lexical/new physical reservation-key quiescence requirement; do not clear locks to manufacture quiescence.

Artifacts: `/tmp/268-current-issue.json` (current issue response), `/tmp/268-source-comparison.json` (exact blob hashes/ancestry), this report. No shared source was modified.
