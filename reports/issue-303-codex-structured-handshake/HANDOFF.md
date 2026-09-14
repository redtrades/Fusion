# Local source-review handoff

Outcome: implemented a Codex-specific, supervised native stdio handshake inside the existing CLI manager/task session. This is a local source-review candidate, not deployed, merged, runtime accepted, or publicly published.

Base: 0e2ee6dc26329caebb21b605af947e7039ad508e. Branch: codex/303-codex-structured-handshake. Worktree: /Users/man/worktrees/Fusion/303-codex-structured-handshake. Root coordinates independent review and integration; peers retain overlay/principal/preparation-cache ownership.

## Verified

- Final scoped engine run: 29/29 tests across six files, zero skips. One additional final durable-ACK test was then added; its five-test manager pipeline rerun passed. Total unique covered tests: 30 engine + 3 core ledger + 4 actual PostgreSQL = 37; no skip.
- Actual PostgreSQL ephemeral port64589, isolated synthetic database, runner exit0 and finally stop completed. Fresh pending ownership, first inode binding/charging, replay, native identity/project mismatch and Reset fencing pass. No live pilot database used.
- Core and engine TypeScript builds passed, producing native structured transport dist. Scoped production ESLint passes; explicit test file arguments yield five repository-ignore warnings, zero errors. Static gate passed. git diff --check passed.
- Existing native PTY runtime tests and Claude accounting tests pass. All affected loadPty+Codex/protected test fixtures were located and guarded against installed-executable fallback. Synthetic child tests traverse actual manager/store/hub/task-session/observer and require explicit synthetic executable paths.
- The reviewed semantic decision is durable awaiting-file ownership before first request, with no invented inode and no baseline suppression of first usage. Header/cwd/inode validation and a chargeable byte0 read follow. A native completion arriving before recorder flush waits up to the bounded drain interval and still requires a durable accounting ACK.
- Protected Codex resume is explicitly refused in both the new structured route and old manager resume route. No old native session/cursor is reclassified as fresh0. A second turn on the same protected transport is refused.

## Negative evidence and limits

Read VERIFICATION-NEGATIVE.md before using results. A legacy test accidentally attempted the installed Codex executable after its PTY-only mock was bypassed. No matching fixture thread or remaining standalone child was found, but turn/start and inference count are unknown. This is not zero-inference proof. No unrelated session content was searched. The failure was fixed with explicit test-only spawn guards and synthetic manager coverage.

The initial no-turn installed 0.154.0 thread/start receipt confirms external identity/path grammar and an absent native future path, not actual first-request counters. The final source enforces the selected executable's exact version before thread/start and validates returned root ID/path/cwd/model/provider. The no-turn proof predates this implementation. No new real-pilot dispatch is claimed.

The bounded compatibility choices are intentional: only Codex0.154.0, equal root thread.id/sessionId (distinct semantics retained), no protected resume or continuation, no automatic approval/input responses, no silent translation of unsupported TUI/elevated flags. Such paths fail closed. Native interactive approval requests currently end this attempt as failure; interactive approval handling is not implemented.

Existing nonempty history at fresh admission is rejected, including metadata-only populated files. A native zero-byte or absent file remains pending. Future versions changing that creation timing need an explicit compatibility change. File creation/header deadline defaults to10s; final recorder-flush drain waits up to1s for first usage, then fails closed. Observed caps permit in-flight overshoot. Mixed PI/CLI and fleet accounting are unchanged and not claimed.

Full repository lint/typecheck/build, the full merge gate, fresh boot smoke, independent exact-source review, actual native first-request accounting canary, crash/resume acceptance, and end-to-end pilot acceptance have NOT been run/completed by this task. Focused tests and static gate are not substitutes for those gates. No service remains from the isolated PostgreSQL test runner. No auth/config/trust setting, shared checkout, overlay, lifecycle mapping, or public remote was changed.

## Consumer contract

Protocol remains native-cli-observed-v1. inspectCliTokenBudget returns launchGate native-structured-identity-before-prompt for Codex; Claude remains authenticated-identity-before-prompt. Session phase now includes awaiting-file; it is never positive success proof. Consumers still require exact admitted session/lease plus drained accounting. Configuration inspection is not runtime readiness; selected executable version, handshake validation and durable admission gate injection in the native path.

## Next owner actions

Root obtains independent review on the delivered full commit, composes with the peer-owned overlay compatibility update, and runs remaining merge/boot/runtime acceptance gates. Public Fusion remotes are explicitly unauthorized publication destinations; preserve this as local/private integration evidence only.
