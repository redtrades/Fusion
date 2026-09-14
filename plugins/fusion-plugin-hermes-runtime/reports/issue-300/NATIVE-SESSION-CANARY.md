# Native Hermes session canary

Evidence mode: fallback, installed source plus one actual free-provider native session.
Plugin revision: ed6aa40896008746721703f656c0ed201dca4c75.
Installed Hermes source: 98a3324821c64b78c13d5d0f105508da0ab71cee.
This is operational evidence, not a deployment, budget-enforcement, or full-pilot claim.

## Verified result

The existing compiled HermesRuntimeAdapter invoked native `hermes chat` and then
its exact-session export reader. No source changes or alternate executor were used.
Native session `20260914_011211_0100a1` persisted and exported successfully.
The assistant returned exactly `NATIVE_SESSION_OK`.

- Native model: `upstage/solar-pro4:free`; billing provider: `nous`.
- One API call, zero tool calls, two messages, no parent/compression session.
- Persisted tokens: 613 input, 39 output, 192 cache read, zero cache write.
- Native reasoning tokens: 34, reported separately from the plugin receipt.
- Estimated cost: USD 0; actual billed cost is null, not independently verified.
- The plugin's latest-attempt `hermes-session-export-v1` receipt matches the exact
  native ID, provider/model and four supported cumulative token counters.

The redacted native export is preserved in
`/tmp/300-hermes-native-session-proof/native-session-export.jsonl`.
SHA-256: `33eb2940108bea83361732c40b53ae976c90bd9b8dcf3462b12ad170534b3c20`.
Selected machine-readable evidence is in `verified-receipt.json` in that directory;
`canary.mjs`, configuration, preflight and cleanup receipts preserve the procedure.
The original session database was disposable; the exported evidence remains.

## Controls and cleanup

Parent explicitly authorized the new mode-0700 profile
`~/.hermes/profiles/canary-300-native-20260914-standards` and ordinary native
same-account authentication resolution. No credentials were copied or manually
changed. No existing profile or default-selection setting was intentionally edited.
Only that owned disposable profile was removed, after export; the child exited.

The actual CLI configuration and native tool-definition resolver were checked
before inference. Both fallback lists were empty. Compression, automatic title,
background review and both memory stores were disabled. Safe-mode plugin/MCP
suppression and ignore-rules were process-local. The resolved native tool list was
empty. Native credential discovery initially added `x_search` despite an empty
platform list; supported `agent.disabled_toolsets: [x_search]` explicitly excluded
it. No browsing, fixture tool, local model, paid fallback or auxiliary call occurred
in the successful one-call native session.

The plugin ran with maxTurns 1, a 90-second native run budget, 120-second CLI timeout
and an abort backstop. No cancellation was needed; this run does not independently
prove cancellation behavior. The unchanged compiled plugin copy used the already
built core from the integration worktree because this plugin tree's core dist was
absent. Compiled plugin bytes were compared equal before execution.

## Negative evidence and limits

An earlier external scratch home failed native auth before producing a session ID:
`Hermes is not logged into Nous Portal`. No receipt was accepted. Installed
`hermes_constants.py:165–181` treats an external HERMES_HOME as its own global root;
only the authorized native profile could use the existing global auth fallback.
A raw read-only SQLite diagnostic against that failed scratch database also failed
to open; the successful proof uses supported native export, not that diagnostic.

This proves one real persisted native session and the existing plugin receipt path.
It does not prove mixed-provider accounting, fallback/compression lineage, per-call
budget enforcement, process admission identity, installed Fusion plugin-loader
registration, production graph dispatch, or a complete pilot. No extra model call
was made to test those unrelated claims. Source tests were not rerun: this task
changed only this operational report.
