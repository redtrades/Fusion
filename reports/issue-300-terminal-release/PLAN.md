# Native terminal release plan

Base: 4c39af127982e5664197d93da49ec371096e9844. Evidence: current repository source and prior real PostgreSQL regressions; no full recall claim.

1. Reuse the native continuation replacement transaction for A4 suspension. Publish a distinct held continuation and currentTerminal reference atomically with pause and receipt. Existing receipts lacking supported top-level bindings remain suspended and unavailable for release.
2. Add a trusted-caller store release primitive. Validate current checkout ownership, durable terminal identity, held/successor state, selected workflow pin and top-level blocking node. Publish a deterministic successor before clearing pause in the same transaction. Actor strings are not authorization; the outer binding must enforce human/orchestrator authority.
3. Prove actual PostgreSQL rollback, duplicate replay, legitimate new checkout, Reset invalidation, unsupported/changed binding refusal and original graph finalization isolation. No claim about overlay accepted-phase consumption or UI availability.

Scope: task-store A4 and checkpoint metadata, narrow existing transaction reuse, release module and store facade, focused PostgreSQL and outer graph regression, changeset and handoff. No Reset policy changes, Board/overlay changes, inference, live database or public push.

Negative evidence: terminal xmin cannot authorize release after legitimate checkout; metadata survives Reset; generic replacement may recreate terminal rows. Release must instead validate the current native held/successor row before replacement and never replay by recreating it.
