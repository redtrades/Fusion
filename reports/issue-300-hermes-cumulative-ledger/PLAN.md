# Core-only Hermes cumulative ledger

Scope approved by root: native core usage types, fenced task operation, existing unit/PG ledger tests and evidence/changeset only. Base b2ffa7cf79b09ea9ee26f021058c4fd21c95d76d. Other owners handle native Hermes/host/engine integration; no overlap, installs, inference or shared DB access.

D1: preserve legacy CliTokenCursor and Codex/Claude write input as compatible union arms. Add explicit Hermes write/cursor kind `hermes-session-cumulative`, real nativeSessionId and supplied cumulative usage; callers cannot choose event keys. Internally use hermes:<nativeSessionId>/session-cumulative. No transcript fields/model identity for Hermes.
D2: under existing Reset advisory+row transaction verify actual cliSessions Hermes/project/task/native session + captured four-part checkout owner. Atomic durable delta/checkpoint/aggregate/pause; no shadow totals. Require finite positive hard limit for Hermes. Same-stream rollback refuses, one initial baseline excludes historical totals, failed updates credit valid increases and remain failed.
D3: test public recordCliTokenUsageFenced using existing real isolated PostgreSQL harness: replay/restart, resumed baseline, rollback/failure, wrong identity/lease/Reset, parallel sessions, capacity/persistence rollback. Test native cursor validation. RED before source changes. Existing Codex/Claude regressions must remain green.
D4: verification: targeted unit + actual PG, core build/typecheck, production lint, changeset format/diff. Dependencies reused read-only from accepted integration without installing; outputs local. Own ephemeral PG is always stopped/reaped. No runtime completeness/host registration claim.

Root approved signature-only compatibility extension: core store.ts and index.ts expose NativeTokenUsageWrite/HermesTokenUsageWrite while retaining legacy CliTokenUsageWrite. Engine consumer typecheck uses candidate core through an owned dependency link; no engine source changed.
