# Verification negative evidence

Evidence mode: current source and local test output. No runtime acceptance claim.

2026-09-14 01:04:59 local, focused test run: a preexisting protected Codex alias fixture mocked only loadPty. Selecting the new structured path bypassed that mock and attempted default `codex app-server --stdio` (PATH resolves /Users/man/.local/bin/codex). The fixture's prompt was "do work"; it failed after ~1013ms waiting for a fake PTY write and cleanup killed the session. The child PID/native identity/turn requests were not instrumented in that run. Zero inference cannot be asserted from the timeout.

After detection, composed tests paused. Read-only allowlisted query of /Users/man/.codex/state_5.sqlite threads for exact fixture cwd prefix /private/tmp/fusion-budget-pipeline-% returned zero rows. Process command inventory contained no standalone /Users/man/.local/...codex child. This supports no surviving owned child or matching persisted native session; it does NOT prove no request was sent. No usage/provider/model was available to measure. No global config/trust/auth was modified.

All packages/engine test sources were checked: cli-token-budget-pipeline.test.ts is the only test selecting usageProtection, and the only loadPty fixture also selecting Codex. runtime-postgres.test.ts is another loadPty fixture but does not select Codex. New structured tests use an explicit harmless synthetic child. The legacy fixture now has a fail-fast test-only spawn guard and regression verifying it; native manager coverage will use a synthetic executable, not be replaced solely by observer tests.

Initial RED transport test: missing new module, 1 failed suite. Initial RED fresh observer tests: 3 failed (admitFresh absent). First GREEN observer run revealed an incorrect assertion that final drain itself held the usage batch: charging occurred on the pre-drain read and final ACK had an empty batch. Assertion corrected to inspect all writes and require baseline:false plus final drained phase; no production change for that assertion.

Claude plan feedback was relayed by root: no policy contradiction, add thread.id != sessionId test and root-thread schema provenance. This is plan review only, not source approval. The implemented bounded slice explicitly rejects unequal root IDs rather than silently substituting sessionId.
