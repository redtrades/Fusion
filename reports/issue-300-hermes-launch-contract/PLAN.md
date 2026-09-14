# Approved Hermes launch contract repair

Evidence mode: exact source830cacd7c2992864328f1e3741fa1564d406e4d4. Isolated branch codex/300-hermes-launch-contract. Parent approved plugin-only repair; no core/engine/UDS/ledger/guard-mode changes.

Preserve actual createSession cwd through existing invokeHermesCli/superviseSpawn. Retain beforeSpawnSession and invoke once after async binary launch resolution, immediately before spawn with cancellation recheck. Refusal or abort before spawn yields no child. Keep ordinary settings/env/default launch arguments unchanged.

Track each session's pending prompt and private cancellation controller. Both session.dispose and runtime.dispose are awaitable; disposal aborts only that session and waits for owned native close through existing supervised child waitExit. Preserve honest aborted outcome even if child emits successful output during shutdown; no accepted post-cancel native receipt. Concurrent prompt on one session refuses rather than losing ownership; independent sessions remain independent. No general process framework.

RED-first real harmless synthetic executable through actual adapter/supervisor: cwd marker, callback order/count, callback rejection and abort zero spawn, dispose during callback and active child, own-child reaping and no post-cancel receipt/text. Existing plugin tests encode current args/settings/receipt behavior and must remain meaningful. Adjust fake child close semantics where current tests omit real Node close behavior. Run plugin tests/typecheck/build, scoped lint/changeset/diff checks; record negative evidence. Freeze local commit for independent Claude review, no integration/push/auth/env widening/install/model/DB.
