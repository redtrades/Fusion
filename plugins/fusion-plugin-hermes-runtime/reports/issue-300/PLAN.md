# Hermes pilot compatibility plan

Evidence mode: fallback source evidence. Base e89cc740fc59a1a16e214b734c7e06ccb744cb1a. Parent task authorizes existing plugin only, isolated implementation and tests; no services, inference, public push or account changes.

Goal: retain native Hermes execution and expose honest cancellation and cumulative session receipts for subsequent pilot integration.

- [x] Test and propagate prompt AbortSignal into existing invokeHermesCli. Pre-aborted requests never start a child; aborted prompts produce no accepted assistant output.
- [x] Test and implement bounded exact-session JSONL export reader through existing `hermes sessions export - --format jsonl --session-id ID --redact`. Require exact returned ID, concrete metadata and nonnegative safe integer counters; discard all transcript fields and avoid exposing child output on errors.
- [x] Add explicit captureSessionReceipt setting, default false for existing installations. On enabled successful invocation, capture immutable cumulative metadata before delivering assistant output. Expose session.nativeReceipt, never fabricate a native CliSession or claim enforced budgets.
- [x] Run all plugin tests and scoped typecheck/build. Record failures, exclusions, exact receipt contract and commit locally.

Owned seams/files: src/runtime-adapter.ts, src/cli-spawn.ts, src/types.ts, new src/session-receipt.ts, focused existing/new tests, plugin-local handoff. Native engine/overlay/fenced accounting excluded.

Upstream inspected locally at 98a3324821c64b78c13d5d0f105508da0ab71cee: https://github.com/NousResearch/hermes-agent ; https://hermes-agent.nousresearch.com ; https://github.com/NousResearch/hermes-agent/releases ; binary `hermes`; upstream-pending-verification. Source: hermes_cli/subcommands/sessions.py export flags, hermes_state_portability.py:240 exact session export.

Rejected: `-z --usage-file` changes current chat semantics and auto-enables YOLO upstream; no paid fallback or approval changes permitted. Export snapshot is cumulative and session-row scoped, not per-call deltas or multi-model/compression lineage proof. No observed hard budget enforcement is delivered here.

## Bounded receipt API clarity follow-up

Parent authorized plugin-only changes after the preserved Solar FIX/reconsideration of bc6fb63. Clarify that nativeReceipt is the latest successful cumulative snapshot for the current attempt, cleared when the next non-preaborted attempt starts, not durable history. Distinguish supplied-signal cancellation at readHermesSessionReceipt with a sanitized Error named AbortError; keep all other export errors generic. Do not propagate signal.reason, subprocess diagnostics, or change chat/fallback settings.

Test this existing public seam first: active real subprocess cancellation, already-aborted no-launch, and malformed real subprocess export must distinguish cancellation from unavailable output without leaking diagnostics. Then run the plugin suite and typecheck/build before local commit. No inference, graph cancellation generalization, shared profile edits, or public push.
