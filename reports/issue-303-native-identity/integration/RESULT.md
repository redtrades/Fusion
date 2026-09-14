# Native identity composed verification

Evidence mode fallback: frozen source, exact Claude source review and actual isolated tests. Sourcec7d04532315ce85fd072a33f4446b79edb905065 integrated as ebe0fef69 on1c94729c1. Owner evidenceb974322 integrated8f82c3780; failed Hermes review evidencebe753d6 integratede374cc040. No cherry-pick conflicts.

Independent reviewer: Claude Sonnet5 (claude-sonnet-5), desktop task Agents foundation identity binding review, actual UI model Sonnet5 verified. Exact source/base/scope/PASS and declared read-only limits retained verbatim in claude-exact-review.md. Same reviewer helped with the design; implementation author is Codex. Root additionally inspected observer/writer/capability diff. No tests were attributed to Claude.

Coordinator on composed source:39engine tests/6files,3core ledger tests/1file,9actual isolatedPG tests/1file, all PASS, zero skips. Native child and outer runner exits both0. Core and engine builds both exit0. Unique testPG stopped in finally. Process check found no matching PostgreSQL server. No real model/CLI request, live task or production database used.

Hermes Nous/Solar review was NOT a verdict: requested180second agent budget did not interrupt pending API call, owned process stopped after236+seconds, exit143. Tool-free helper had no native sessionDB; no exact usage receipt recovered. Usage/cost UNKNOWN, notzero. Raw timeout and source-recovery evidence remain separate. No repeat of that review. Remote-reader Solar review later also hit an externally enforced180s deadline; that separate source is now with a fresh Claude reviewer.

Reproduction: copied the archived ownerPG runner into this directory, repointed only two worktree paths and a new temporary prefix, and added a fresh child-exit receipt plus outerPython check so PostgreSQL cleanup cannot mask failures. Exact source test commands remain in evidence/REPRODUCE.md. Raw integrationlogs are losslessly gzipped with hashes below; no test outputs edited. Local integration does not prove fullgraph, deployment or three unattended traversals.
