# Native CLI observed token-budget handoff

Evidence mode: current committed-base source, deterministic fake-PTY/native
pipeline tests and isolated PostgreSQL tests. Scope: root-delegated issue300.
Base9cc409405a13e2443b2ab1d891e7b2a3d373b0ab. Worktree:
/Users/man/worktrees/Fusion/300-cli-observed-token-budget.
No public push, installed credentials/config changes, local inference, live4040
changes, or shared/integration tree edits. Parent retains review/integration.

## Delivered contract

Task CLI nodes with a configured finite hard budget enter the native observer
path. Work tokens are uncached input + output + cache writes, excluding cache
reads. On an observed crossing, the same transaction persists usage/checkpoint
and pauses the task; the native CliTaskSession kill path stops the child. This
cannot prevent tokens already in flight. Exhausted tasks cannot launch another
CLI node. Missing schema, malformed usage, missing/untrusted SessionStart, wrong
identity, persistence refusal or final drain failure cannot produce success.

Durable accounting uses sourceMetadata.cliTokenUsage plus existing token columns
under the task advisory transaction lock and row lock. It checks the native
session row and exact project/task/native ID/current checkout run, epoch, agent
and host. Replay checkpoints and aggregate totals commit together. Ledger growth
is bounded (4096 message snapshots,1MiB); refusal never evicts evidence. Reads are
incremental64KiB, bounded16MiB per pass,1MiB partial line. A restarted observer can
replay from byte0; native/message cumulative maxima avoid double counting.
Baseline excludes preexisting history on a newly bound native conversation.

Protected legacy automatic recovery/followUp cannot bypass admission: they refuse
until an admitted launch supplies native usage observation. This change does not
provide automatic protected session recovery across engine restart.

PluginContext.readCliTokenBudget(query) is a late project/lifecycle-bound readonly
host method. Query: taskId, adapterId(codex|claude-code), admission{runId,leaseEpoch,
agentId,nodeId}, optional sessionId. It returns protocol native-cli-observed-v1,
hardLimit, observedWorkTokens, launchGate authenticated-identity-before-prompt;
with sessionId, exact session/nativeSessionId, phase and credited workTokens.
Session proof requires the admitted ledger owner. A post-success consumer must
require phase=drained. Capability inspection does NOT assert native hook trust
or runtime CLI version compatibility.

## Stable hook installation and canary (root-owned, not executed here)

Build core/engine first. The stable command is the runtime Node executable plus
<COMPOSED_FUSION_ROOT>/packages/engine/dist/cli-agent/native-hook.js. Determine Node
with `node -p process.execPath` in the actual runtime environment. Both command
paths must be quoted for the shell. The command never contains a session token;
its native-only FUSION_CLI_HOOK_CONTEXT environment variable names a0600 context
file under the session's0700 scratch directory. Outside a Fusion child it is inert.

Append this stable command to <repo>/.codex/hooks.json beside the trusted
project configuration layer, preserving all existing entries. Root verified the
pilot runtime Node path is /Users/man/.hermes/node/bin/node. Official SessionStart shape:

```toml
[[hooks.SessionStart]]
matcher = "startup|resume"
[[hooks.SessionStart.hooks]]
type = "command"
command = "'<ACTUAL_NODE_PATH>' '<COMPOSED_FUSION_ROOT>/packages/engine/dist/cli-agent/native-hook.js'"
```

For the known composition path, the hooks.json entry to append is:

```json
{"matcher":"startup|resume","hooks":[{"type":"command","command":"'/Users/man/.hermes/node/bin/node' '/Users/man/worktrees/Fusion/300-live-integration/packages/engine/dist/cli-agent/native-hook.js'"}]}
```

Place that entry in the existing hooks.SessionStart array, then use native
`/hooks` to review/trust it. This configuration is root-owned startup work after
composition/build; it was not installed by this implementation task.

Source supplied/verified by coordinator: https://learn.chatgpt.com/docs/hooks.
The corresponding hooks.json representation is hooks.SessionStart containing
that matcher and command hook. Use the actual CLI's supported isolated config
location and `/hooks` trust flow. This patch does not replace existing hook lists,
write global hooks, forge managed policy or bypass hook trust. Codex notify argv
is wired natively per launch to the same stable command. Claude gets the stable
command through its existing per-session hook settings.

Expected authenticated SessionStart payload: hook_event_name=SessionStart,
session_id=<actual native ID>, transcript_path=<absolute native file, aliases resolve to the same canonical file>.
The endpoint validates the exact Fusion session token, passes the path through
an internal listener only, and persists native identity. Codex additionally
requires session_meta.payload.id and canonical cwd to match; Claude usage rows must carry
the exact parent sessionId. Nullable transcript_path currently means no prompt
and a readiness refusal; no latest/cwd-only file guessing is used.

No-inference startup must demonstrate this authenticated receipt and observer
baseline before any task prompt. Then the separately authorized usage canary must
confirm actual installed usage schema. Checked fixture versions are Codex
0.154.0-alpha.6.2 and Claude2.1.266. Reported installed CLI versions are Codex0.154.0
and Claude2.1.270: fixtures do not prove those binaries' current runtime behavior.

## Verification and negative evidence

- Parser and pure-ledger tests initially failed because the new modules were
  absent. Normalization/replay tests now pass.
- Native fake-PTY pipeline initially failed because its readiness fixture used
  an unsupported glyph; corrected it to the existing adapter's `> ` signal.
  This also exposed that the hook deadline must run concurrently with PTY
  readiness, now covered by missing-hook/no-prompt test.
- Existing receipt mocks lacked the newly used TaskStore settings/task reads;
  fixtures were completed. Partial project-settings type required the same
  resolved-budget cast used by existing native enforcer callers.
- Default PG run skipped2tests because no test server was listening. An isolated
  ephemeral embedded PostgreSQL instance then ran the suite without skips and
  was stopped afterward. /tmp/fusion300-budget-pg-run.mjs reproduces that setup;
  it creates only temporary test databases and never uses the live project DB.
- Final checks all exited0: 26 engine tests/5files;12 core loader/ledger tests/4files;
  3 isolated PostgreSQL tests/1file (including an actual advisory-lock wait behind
  concurrent Reset);2 dashboard authenticated transport tests/1file. Total43tests,
  11files, no skips in the final selected suites.
- Core and engine builds (pnpm --filter @fusion/core build; pnpm --filter
  @fusion/engine build) passed. Dashboard typecheck (both server and app) passed.
- Production ESLint passed with one preexisting empty-catch warning in
  plugin-loader.ts; changeset validation and git diff --check passed.
- The positive-hard-cap and canonical filesystem alias corrections were tested:
  native manager/observer accepts a symlink worktree/transcript and canonical
  Codex cwd only when both resolve to the same physical identity.

Evidence logs: /tmp/fusion300-budget-{engine-final,core-final,pg-isolated,
dashboard-tests,core-build,engine-build,dashboard-type,lint,changesets}.log.

Reproduction: engine vitest selection is cli-token-budget-capability,
cli-token-budget-pipeline,cli-token-usage,run-cli-agent-node-session-receipt,
plugin-native-session-reader under src/__tests__, project engine-default.
Core selection is cli-token-usage-ledger,plugin-loader-session-reader,
plugin-loader.route-context,plugin-loader-lifecycle-scope. Dashboard selection
is src/__tests__/cli-agent-hooks-native-identity.test.ts. PostgreSQL selection is
src/__tests__/postgres/cli-token-usage-fenced.pg.test.ts with an isolated PG URL.

Limits: sequential all-CLI task pilot is the intended acceptance target. Existing
PI token aggregate writers use their old process-local update path, so concurrent
mixed PI/CLI writers can still overwrite totals; that wider accounting migration
is outside this claim. Fleet aggregate accounting is not implemented. This patch
implements hard-stop enforcement; it does not claim new soft-alert delivery.
Source tests/builds are not native CLI trust, version, live pilot or merge proof.
