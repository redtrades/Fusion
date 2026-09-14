# Issue 300 composed checkpoint

Evidence mode: fallback, local Git source and executed tests. This is a local-only
integration record, not deployment or pilot acceptance.

## Current composition

Source revision `0ad9cf73381210cf3e8fd138017558682f86b2e5` composes reviewed
accounting `e89cc740fc59a1a16e214b734c7e06ccb744cb1a` over A4 integration
`278d55a516146ee4217af67f949eeb9000b84ed0`.

Core and engine builds passed. Selected checks passed without skips: 26 engine,
17 core ledger/loader, 2 dashboard hook-identity, 25 isolated PostgreSQL accounting,
checkpoint and terminal-fence tests. Total 70. The temporary PostgreSQL service
stopped, with no listener left. Built `packages/engine/dist/cli-agent/native-hook.js`
exists. Logs: `/tmp/fusion300-composed-0ad9-verification/SUMMARY.md`.

## Separate Hermes compatibility lane

`bc6fb63ef2ea43b03b2e46dbc3e1e16c77634076` remains in the isolated
`/Users/man/worktrees/Fusion/300-hermes-runtime-receipts` checkout, not composed here.
It forwards cancellation and optionally captures exact-session cumulative usage.
Worker verification: 89 plugin tests, build and typecheck passed. The installed
Hermes 0.21.2 exporter interoperated with the reader using an isolated synthetic
SessionDB row, zero messages and no inference. A real pre-abort subprocess check
confirmed no child launch.

Negative evidence: a free API review's usage-file ID had no persisted SessionDB
row. Export exited zero with no match; the reader rejected it. Session identity
in a usage file is insufficient to prove export availability.

Independent Nous Solar free-only source review and one reconsideration both
returned FIX. Raw results remain unchanged under
`/tmp/agents-intent-alignment-20260914/hermes-plugin-bc6fb63-review/` and
`hermes-plugin-bc6fb63-reconsideration/`. Source disposition disproves missing
abort checks/listener cleanup; receipt retention and generic cancellation errors
remain review concerns. No independent PASS or completed D6 acceptance is claimed.

## Open work and constraints

The actual WIP-to-blocked move still fails native lifecycle F5. Merely adding a
WIP trait does not establish terminal suspension: recovery paths also inspect
paused state. Reconcile this existing contract before claiming blocked acceptance.
Do not spoof Plan Review REVISE, relax lifecycle guards, or infer runtime success
from source tests. Startup trust, real usage enforcement, admitted Hermes graph
execution and crash recovery remain unproven. WS 1.7's eight checks and the separate
three-unattended-traversal milestone remain outstanding.

No public Fusion push, live4040/KB003 mutation, account change, GBrain operation
or local inference occurred. User allocation: Hermes is the main future swarm
home; Grok Bot is reserved for X research; Grok CLI is separate coding capacity.
