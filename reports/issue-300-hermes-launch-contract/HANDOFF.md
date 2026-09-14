# Hermes launch contract repair

Evidence mode: current source and executed plugin tests. Parent-authorized plugin-only implementation on base `830cacd7c2992864328f1e3741fa1564d406e4d4`, branch `codex/300-hermes-launch-contract`, worktree `/Users/man/worktrees/Fusion/300-hermes-launch-contract`. This commit requires independent exact-revision review before integration.

## Result

The adapter retains the supplied session cwd and host beforeSpawnSession callback. Existing invokeHermesCli resolves its launch asynchronously, invokes the callback once, and checks cancellation immediately before native superviseSpawn. Refusal, pre-abort, or abort during that callback creates no child. Existing args, profile, environment and ordinary callback-free behavior remain unchanged.

Each session owns an active prompt promise and private AbortController. Session dispose now returns its runtime's awaitable dispose promise (structural type `void | Promise<void>` preserves compatibility). Awaiting disposal cancels only that session and waits for the existing supervisor's actual close receipt. SIGTERM escalates to SIGKILL after two seconds if needed. Calls that ignore the returned promise initiate cancellation but do not observe completed teardown. Repeated disposal is safe; later prompts refuse. Concurrent prompts on one session refuse instead of replacing its active ownership. Independent sessions remain independent.

Successful-looking child output during cancellation is rejected. Cancellation also prevents a late export result from publishing nativeReceipt. Receipts remain opt-in, latest cumulative snapshots, not durable history or budget proof. A completed native session ID remains available if later export fails, preserving existing continuity semantics.

## Verification

From `plugins/fusion-plugin-hermes-runtime`:

- `pnpm test`: **99 passed, 8 files**, including seven new actual harmless-child launch/lifecycle cases and one additional late-export cancellation case.
- `pnpm typecheck`: PASS.
- `pnpm build`: PASS.

From worktree root:

- `pnpm exec eslint` on the six changed plugin source/test files: exit 0, production source PASS; existing ESLint configuration ignores the three test files (three warnings retained). Test files were verified by TypeScript and executed tests.
- `node scripts/check-changeset-format.mjs`: PASS.
- `node scripts/check-fnxc-future-dates.mjs`: PASS.
- `node scripts/check-plugin-interop-drift.mjs`: PASS.
- `node scripts/check-mock-completeness.mjs`: PASS.
- `git diff --check`: PASS before freeze.
- Optional repo-wide `check-file-line-count.mjs`: FAIL, 112 existing violations. Byte comparison against base confirms **all 112 files unchanged**; no baseline adjustment. Raw failure and disposition retained.

Tests use the real adapter, CLI invoke path, and native supervisor with explicit harmless Node executables. A spawn interception rejects any executable other than the fixture's harmless.cjs. All created fixtures and recorded owned children are cleaned. Tests cover cwd, callback ordering after delayed launch setup, zero spawn on refusal/abort, two-session cancellation isolation, actual child reaping, SIGTERM refusal requiring escalation, overlap refusal, and disposal during an unresolved callback. Existing mocks now emit Node's close event following spawn error/timeout/cancel and implement actual waitExit semantics.

## Negative evidence and limits

Initial RED execution: all four original launch-contract tests failed, proving discarded cwd/callback and no-op disposal. Its timed-out disposal test also produced two cleanup-triggered unhandled assertion rejections when the fixture cleanup killed children; raw RED evidence retained. The first complete plugin run passed 95 tests, extended runs passed 97 then 99. Initial typecheck identified two implicit-any parameters in the updated fake supervisor; explicit close-event types fixed them. No test failures or unhandled errors remain in the final run.

No Hermes binary, provider, inference, DB, global configuration, credentials, engine/core modification, UDS channel, task registration, finite-budget guard, or hosted operation was executed or implemented. This does not prove full task-owned Hermes execution or parent ownership. Those remain separate planned seams. Disposal waits for existing launch resolution if that resolution itself is pending; it cannot cancel arbitrary host callback side effects, but its cancelled invocation cannot subsequently spawn. Main supervised-child close is verified; session export retains its existing execFile cancellation mechanism without a new supervisor or ledger.

Dependencies were reused through four temporary local node_modules symlinks to accepted integration; no installation or tracked dependency changes. Build artifacts remain ignored. Raw logs are compressed byte-preserving artifacts with a SHA256 manifest.
