# Issue 300 Hermes compatibility handoff

Evidence mode: fallback, local source and executable tests. Parent authorized this plugin-only boundary from e89cc740fc59a1a16e214b734c7e06ccb744cb1a; worktree /Users/man/worktrees/Fusion/300-hermes-runtime-receipts, branch feat/300-hermes-runtime-receipts. No services, inference, account changes, public push or shared checkout edits.

## Delivered

Existing Hermes prompt options.signal now reaches invokeHermesCli; already-aborted requests cannot spawn. Explicit captureSessionReceipt:true requests an exact-session export after successful chat before assistant output delivery. Default installations do not request exports. Native session ID is retained if export fails, preserving resume identity; the failed turn is not presented as accepted assistant output.

Public seam: readHermesSessionReceipt(settings:{binaryPath:string;profile?:string}, sessionId:string, signal?:AbortSignal):Promise<HermesSessionReceipt>. Receipt has schema hermes-session-export-v1, sessionId, scope session-cumulative, reportedModel, reportedProvider, and usage inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens. Values are reported metadata, frozen, and strictly validated as nonnegative safe integers. Native runtime exposes session.nativeReceipt.

Uses supported `hermes sessions export - --format jsonl --session-id FULL_ID --redact` in the configured profile. Requires exact returned ID despite upstream prefix lookup. Maximum captured stdout/stderr is 4 MiB each, timeout 10 seconds, cancellation kills the export. No exported messages or child diagnostic output are returned in errors. Export parser retains selected metadata only.

## Verification

Plugin vitest suite: 89 tests / 7 files passed. Plugin tsc --noEmit and tsc build passed. git diff --check passed. Cancellation regressions first failed on dropped signal and actual pre-cancelled spawn; receipt public-seam regressions first failed with unavailable implementation. Tests cover real bounded fixture subprocess exports and active export cancellation; no actual Hermes inference.

Dependency setup initially failed because core drizzle-orm was not linked; isolated node_modules links to the verified e89 dependency installation resolved it. The temporary fake executable named hermes correctly hit the repository test anti-inference guard; renaming our generated fixture executable to receipt-fixture exercised the real subprocess without changing or bypassing that guard. Exact-settings tests caught an unnecessary false-valued new field; default settings shape was preserved.

## Boundaries and negative evidence

Inspected upstream Hermes source 98a3324821c64b78c13d5d0f105508da0ab71cee, not a runtime acceptance canary. Its oneshot --usage-file mode changes approvals (automatic YOLO) and permits configured fallbacks, so it was rejected in favor of existing chat + read-only export. Existing chat fallback/auth behavior is unchanged. No new paid fallback is introduced.

Snapshot is cumulative for the returned session row. It does not establish per-turn deltas, compression lineage completeness, mixed-model/provider history, exact model-family attestation, observed hard-limit enforcement, admission/lease fencing, crash recovery, or a native CliSession record. An export failure is a failed receipt, not proof no inference occurred; native session ID remains available. Aborted/incomplete inference may not yield an ID/receipt. Export availability and installed-version metadata semantics still need root-owned no-inference/read-only canary and later admitted integration. Existing cwd propagation and engine cancellation call-site coverage were not generalized in this plugin-only scope.

Integration must retain independent exact-revision review. A release changeset, if required by bundled distribution integration, belongs to the integration owner; this assignment explicitly owns only plugins/fusion-plugin-hermes-runtime. No complete Build/Gate claim is made for the whole engine.
