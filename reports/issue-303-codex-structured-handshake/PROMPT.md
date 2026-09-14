# Issue 303 native structured handshake

Evidence mode: fallback evidence from the current committed Fusion tree, installed protocol generation, upstream rust-v0.154.0, and the allowlisted no-turn receipt. The approved scope is root's delegated issue300/303 slice on base 0e2ee6dc26329caebb21b605af947e7039ad508e. Other agents own overlay/principal and preparation cache. No shared checkout edits, public publication, auth/config/trust changes, or pilot acceptance claim.

## Symptom Verification

Original symptom: protected Codex waits for SessionStart identity before injecting a request, but native 0.154 emits that hook only inside a turn. The native no-turn thread/start response provides an exact ID and authoritative path before materializing the rollout.

Exact reproduction: codex-structured-handshake.test.ts uses a synthetic native stdio peer with no hook event; cli-codex-structured-pipeline.test.ts exercises the actual manager/store/task-session/hub/observer with an explicitly selected synthetic executable. The peer returns a future path before the turn and publishes the file after turn/completed.

Assertion it is gone: no turn/start before durable fresh admission; first cumulative usage charged from zero; final success waits for file/header/counters and durable drain. Cancellation during admission, unsupported version/root identity, prior usage, malformed stream, path/inode change, approval request, and exhausted observed budget fail closed. Actual native inference/counter acceptance is not claimed. See VERIFICATION-NEGATIVE.md for the accidental legacy fixture executable attempt and its unproven request count.

## Source provenance and bounded semantics

- Canonical upstream: https://github.com/openai/codex
- Version release: https://github.com/openai/codex/releases/tag/rust-v0.154.0
- External protocol: https://learn.chatgpt.com/docs/app-server
- Exact source commit: 6b9826e3aa83b1a5947db50f4332cb9c65f1b340.
- thread_processor.rs lines1524–1531 builds the external Thread from thread_id, separately session_configured.session_id, and rollout_path: https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server/src/request_processors/thread_processor.rs#L1524
- recorder.rs lines874–884 writes SessionMeta with distinct session_id and id:conversation_id plus cwd: https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/rollout/src/recorder.rs#L874
- Installed generated Thread schema calls id the thread UUID and sessionId the session-tree ID. This bounded fresh-root implementation rejects divergence explicitly. The matching no-turn receipt is interoperability evidence, not proof that these fields are universally interchangeable.
- Runtime checks selected command's `--version` equals codex-cli 0.154.0 and validates same-response root ID/path/cwd/model/provider. Binary distribution checksum parity with the tag remains upstream-pending-verification. A changed version is rejected, not silently generalized.
- Only config override argv pairs supported by the native app-server are preserved. Unsupported TUI/elevated flags are explicitly refused; no policy translation or automatic approval. Native server requests requiring user input/approval fail closed.
- The child is owned by existing superviseSpawn and the native session manager. JSON-RPC is not a PTY. Attachment is read-only; no actor/network endpoint is added. Native approved request text is sent once through turn/start, never argv.
- Fresh admission permits an authoritative future path with no invented inode. Existing nonempty history is refused. First native metadata binds an actual inode and starts charging at byte0; old resume cannot become fresh0. Missing final file/header/usage or persistence failure cannot acknowledge success.
- Existing-inode-only behavior was an implementation of the old hook observer, not an additional governing invariant found in invoked AGENTS.md. Root explicitly approved awaiting-file admission. The engine process rule requires superviseSpawn and is followed.
- Both structured resume and the old protected-Codex resume path explicitly refuse, preserving the open crash/resume acceptance gap. Protected follow-up is not supported by this fresh-only slice.
- Actual first-request runtime proof, cross-provider/fleet aggregation, mixed PI/CLI accounting, and end-to-end pilot acceptance remain open. Observed budgets permit in-flight overshoot.

## Ownership / planned files

Changes are confined to the native CLI structured transport, manager/task-session, observer, budget capability, core cursor/transaction types, focused tests, this report and a changeset. No workflow executor, overlay, principal, Reset, column policy or shared agent-governance file is modified.
