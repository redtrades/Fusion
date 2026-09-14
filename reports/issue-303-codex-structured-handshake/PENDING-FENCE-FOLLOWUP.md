# Follow-up to immutable ed4de5149e2ce84e857cd0b3ae68999408119ea0

Evidence mode: deterministic synthetic native manager/store/hub reproduction plus actual isolated PostgreSQL transaction tests. Root identified and authorized this bounded correction while independent review continued on ed4; that commit was not amended.

## Confirmed failure

With an absent authoritative future file, beforeFirstTurn read returned on ENOENT without a store ACK. The earlier fresh admission could have been superseded. A tight store fixture changes ownership or exhausts current usage immediately after returning the valid initial admission snapshot. Both tests on ed4 failed because the synthetic peer received turn/start before a later accounting call killed the session. RED: two failures, five passes. No production executable was used; the test-only explicit synthetic executable guard remained active.

A separate actual PostgreSQL RED test proved the existing API rejected an exact pending reaffirmation (one failed, four passed). This was the missing operation, not permission to repeat fresh admission or fabricate a file.

## Correction

Before the first request, after the bounded read, absence of a validated header now triggers an explicit reaffirm:true empty, baseline:false call with the original awaiting-file path, zero bytes and no inode. The native transaction requires the exact existing pending owner/path; it rejects fresh+reaffirm, observations, baseline, an invented inode, changed path or a missing/prior bound cursor. Existing advisory lock, task row lock, current lease/native-session checks and current usage total calculation apply. Repeated fresh admission remains refused. A completed header read already gets its normal fenced accounting ACK.

This closes the demonstrated change-before-beforeFirstTurn gap; it is not an atomic transaction across a remote model request. The budget limit remains the admitted limit snapshot, unchanged by this patch. Dynamic project/global/task policy-limit edits are not claimed to be reread here; current durable task usage and ownership are checked. Any broader policy snapshot handling remains separate work.

## Verification

- Final engine subset: 32/32 across six files, zero skips; includes both zero-turn/start regressions.
- Core ledger: 3/3; actual PostgreSQL: 5/5, zero skips. PG tests reaffirm the unchanged pending stream, reject changed path/repeated fresh, observe budget exhaustion from another native session, and refuse post-Reset ownership.
- Core/engine TypeScript builds, scoped production ESLint and git diff --check pass.
- PG runner exit0 and port49923 independently verified closed. No service left running from these tests.
- Earlier ed4 static gate evidence remains separate. Full merge gate/boot smoke, independent changed-source review and real native accounting acceptance remain open.

Relevant logs are retained in logs/fusion303-reaffirm-*.log. Existing accidental legacy-fixture unknown-inference evidence remains unchanged in VERIFICATION-NEGATIVE.md; this follow-up uses only explicit synthetic native peers.
