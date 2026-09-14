# Coordinator A2 integration verification

Evidence mode fallback: exact source, actual component tests and native review receipt.

Sources e582139d5c352ad8fd52b7fcb27d658f1be09bc4 and ffefe982429f4103e8ae0fadbc4771a4bf9ee69f integrated as a06546398 and 2febf4548 onto379c94d5e7c3bb824baf9b5c3705781904848c36. Review evidence42ba3fcd integrated as23fc6226d. No conflicts.

Root adjudication: raw Hermes Nous/Solar FIX finding F1 is not supported. Every executed script result is checked at workflow-graph-foreach.ts1052; failures return at1057–1071 before edge selection1075 and completion1078. chooseNextEdge returns an edge, not an outcome. Selected failure/unverified/skipped/cancelled regression controls show zero complete calls. No source change is warranted for this finding. Raw review stays FIX; it is not rewritten as PASS. Initial e582 PASS missed the separately reproduced cardinality bug, corrected in ffefe982.

Coordinator verification on composed source:
- Engine projection/foreach/script evidence: 55 PASS,3files.
- Optional-group regression:36 PASS,1file. Combined91 PASS across4files,0skips.
- Actual isolated PG projection/order/proactive/hybrid storage:40 PASS,4files,0skips. Fresh child exit0 and outer exit0 retained in pg.log. Owned database stopped; process check found only the checking shell/rg, no matching PostgreSQL process.
- pnpm --filter @fusion/core build and pnpm --filter @fusion/engine build both exit0 (tool session44554). git diff --check passes.

Negative evidence: first engine invocation included a nonexistent workflow-script-optional-group.test.ts filter; Vitest silently ignored it and ran only3files/55tests. Root inspected actual file names and ran workflow-graph-optional-group.test.ts separately,36PASS. Initial engine.log remains unchanged, never cited as91tests. PostgreSQL runner copied from frozen evidence was repointed only to integration worktree and a new unique temporary prefix/child-exit receipt.

Review native receipt: session20260914_024052_da4b5a, Nous/upstage/solar-pro4:free,2calls,total80440tokens,estimatedUSD0,billed amount unknown. Local integrated source/fixture evidence only. No live KB003/4040, full E2E or unattended traversal acceptance claimed; no public Fusion push.

Staged diff check rejected an optional-group raw log trailing blank line. The log is retained losslessly as optional-group.log.gz; no result bytes were edited.
