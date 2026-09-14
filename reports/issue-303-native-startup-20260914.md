# Issue 303 native startup evidence — 2026-09-14

Evidence mode: fallback evidence from actual local source, no-inference child processes, and native terminal UI. This is a local-only diagnostic report, not pilot acceptance.

## Verified

- Integration source HEAD: `4c39af127982e5664197d93da49ec371096e9844`; most recent production build at `b722dc12be8ec99e80f48385fde0d9f4604d6e84`, followed by test-only change.
- Compiled native-hook SHA256: `310e94862cff69e13c084a4423d000204d790d4b90db9635bb5b08750bc33617`.
- Matched node-pty probes: Node 22.23.2 produced output for `/bin/echo PTY_READY` and `codex --version`; Bun 1.4.2 produced zero bytes and timed out for both. This is a local runtime interoperability result, not a universal Bun claim.
- Under Node, actual native Codex 0.154.0 reached ready and showed a hook review menu. No model prompt was sent and no hook was trusted.
- Interactive native session `cli-975d4360` (exec 90985) listed one SessionStart hook: user config checkpoint_context.py. Fusion project hook was absent.
- A second controlled probe added only an absent comment-only project config.toml alongside hooks.json. Session `cli-5736bec2` (exec 9654) still listed only the user hook. That hypothesis is falsified.
- Both probes completed automatic child/endpoint/PostgreSQL cleanup. Second probe restored the temporary project config and hook files. No SessionStart identity or accounting baseline was received.

## Boundaries and negative evidence

The local transport uses actual CliSessionStore/TelemetryHub but a minimal ephemeral authenticated endpoint and metadata-only budget fixture. It is not the production dashboard router or full task accounting. Injection is disabled. No trust, auth, permission or global configuration changes were made.

Earlier canary receipts hardcoded source revision 03e92a647; do not use that field as current build provenance. The project-layer probe records actual source HEAD and native-hook hash. An earlier interactive handoff expired before root received control; cleanup was verified before rerun.

Do not trust the unrelated global hook to solve missing project discovery, increase timeouts blindly, or claim that ready means instrumented. Supported app-server config/read and hooks/list diagnostics subsequently completed: the canonical project layer was active with disabledReason=null, both with and without temporary candidates. With both candidates present, only four user hooks were discovered and warnings/errors were empty. This rules out a disabled layer and missing config as explanations in that RPC. Candidate files were restored afterward. The next step is supported loader/schema diagnosis, not another TUI attempt.

## Local evidence pointers

All scratch receipts are under `/tmp/agents303-pilot-state-tmnayD/`: `pty-runtime-diagnosis.md`, `codex-interactive-hook-review-observation.md`, `codex-interactive-probe-receipt.json.before-project-layer`, `codex-project-layer-probe-receipt.json`, and `codex-project-layer-probe.diff`, `codex-project-layer-read.json`, and `codex-project-layer-read-without-candidates.json`. The app-server results are worker-reported and their scoped metadata files are available for reproduction. These are host-local evidence, not remote artifacts.

## Hermes co-lead follow-up

Muse was asked for a bounded source-only native request-barrier seam audit. Muse reports that a registered llm_execution middleware can avoid next_call for the main path, but raising fails open, missing middleware offers no barrier, auxiliary compression bypasses it, and no supported refusal response contract exists. This is co-lead-reported source analysis pending local artifact reconciliation; it does not establish a complete budget bridge.

Hermes remains the future primary swarm runtime. Grok Bot remains reserved for X research; Grok CLI is separate coding capacity. Current native pause/release work does not change those allocations or satisfy the eight pilot checks and three unattended traversals by itself.

## Discovery cause and isolated trust proof

Worker source inspection at Codex tag rust-v0.154.0, peeled revision `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`, found config loader redirection of linked-worktree hooks to the root checkout (loader/mod.rs:1127–1137 and 1829–1852). That explains the active worktree config layer with no discovered worktree hook. No hooks were installed into the busy shared root.

A standalone local clone of admitted source 6a4e977 was created at `/private/tmp/agents303-pilot-state-tmnayD/standalone-hook-proof`. It has its own Git directory and local origin. The ordinary native project-trust screen was accepted for this exact clone. In the native hook-review screen root inspected Hook 2, verified the project source, matcher startup|resume, stable Node/native-hook command and 3-second timeout, then trusted that hook individually. Native UI then showed SessionStart: 2 installed, 1 active, 1 remaining review. The four user hooks were not changed or trusted.

Direct native manager proof uses taskId:null and actual isolated CliSessionStore/TelemetryHub with private context, not the KB-002 task lease. Session `cli-73d93d52` established discovery/trust, then exited cleanly. Restart `cli-507f93ea` preserved the one active Fusion hook but still produced no authenticated SessionStart event. Both had zero prompts and cleaned up child, private context, endpoint and PostgreSQL. The harness field hookTrustedByCanary=false denotes no automated trust choices; it does not negate root's recorded manual native-menu action.

Receipts: `codex-standalone-manager-first-trust-receipt.json` and `codex-standalone-manager-receipt.json` under the scratch root. Discovery is fixed in this isolated layout; runtime delivery remains unproved. Next step is exact hook execution/event/environment diagnosis, not another speculative startup retry.
