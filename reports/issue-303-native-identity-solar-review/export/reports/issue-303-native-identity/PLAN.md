# #303 native observed identity binding

Evidence mode: immutable source at Fusion
379c94d5e7c3bb824baf9b5c3705781904848c36. Source-only proposal: no runtime,
authentication, database, model requests or production edits.

## Conclusion

Use the existing native usage ledger and exact-session budget inspection. Carry
Codex's already validated handshake model/provider into its fresh admission,
corroborate it against the same inode-bound native transcript, and preserve
Claude's response message.model alongside its actual message usage. Return that
identity in readCliTokenBudget(...sessionId).session, which the overlay already
persists as provenance.accounting. No new service, session-table migration,
parallel store or generic attestation flag is needed.

One correction to the question: at this exact revision Claude usage parsing
receives the real message object but does NOT read message.model. Adding that
read is necessary; it is not an existing exported fact. Also Claude JSONL
message.model does not by itself identify the transport provider. Missing
provider remains absent, never inferred as anthropic from the model prefix.

## Exact sources and ordering

F1. engine/src/cli-agent/codex-app-server-session.ts:13 currently defines
CodexNativeIdentity as nativeSessionId/transcriptPath only. Lines79–85 request
thread/start with allowProviderModelFallback:false and validate native
thread/session equality, durable path, both returned cwd values and returned
response.model/modelProvider against configured values when supplied. Lines91–93
then discard model/provider when calling onIdentity. Those are RETURNED selected
identity, not proof of a response model. turn():95–98 waits for admission.

F2. session-manager.ts:590–598 supplies configured settings, binds native ID to
CliSession, flushes it, awaits codexStructured.admit and only then marks ready.
task-session.ts:333–335 passes that identity to usageObserver.admitFresh.
Observer:61–74 commits a fresh awaiting-file checkpoint before prompt, using
recordCliTokenUsageFenced. Carry the native returned fields through this chain;
never repopulate them from options.settings after the handshake.

F3. token-usage-observer.ts:153–159 binds the exact inode and refuses replacement
or truncation. Lines178–190 require native metadata/cwd, actual post-baseline
usage, then commit the cursor and observations. parseLine():199–209 validates
Codex session_meta ID/cwd and Claude row.sessionId; it currently ignores Codex
session_meta.model_provider, turn_context.model and Claude message.model.
The committed canary reports/issue-303-codex-structured-handshake/native-canary/
native-transcript-metadata.json:3–18 shows model_provider=openai in session_meta
and model=gpt-6-astra in turn_context; turn_context.model_provider is null.
Use those actual locations, not a fictitious provider field on each turn.
This report is native turn-context evidence, not an actual provider response
model disclosure. Do not rename it responseModel.

F4. token-usage.ts:2,24–30 exposes only {key,usage}; Claude key is the real
message.id. Preserve a bounded model field from that same assistant message
with actual usage. Existing test cli-token-usage.test.ts:8–9 omits model, so
current tests do not prove its extraction or malformed-model refusal.
Observer drain():126–142 waits for final observed usage, and task-session.ts:
344–346 kills its own session on observer failure. Preserve this error path.

F5. core/src/task-store/cli-token-usage-ops.ts:10–22 defines the narrow write.
Lines40–56 lock the task, take the Reset advisory lock, lock/read the row,
verify actual lease and the SQL native session under FOR SHARE, and reject
changed stream ownership. Lines63–64 preserve cursor/path/inode monotonicity;
:79 and :92–99 atomically persist the ledger and usage. Store the bounded
identity under that already-owned adapter:nativeSessionId ledger key with the
same transaction. Do not introduce an independent updateSession/write race.

F6. core/src/cli/cli-token-usage-types.ts:22–27 has owners/cursors/sessions;
:79–84 inspection returns exact session/native IDs, cursor phase and credits.
engine/src/cli-agent/token-budget-capability.ts:15–25 flushes session storage,
checks task/project/adapter/native ID and current ledger owner, then returns
that session. Add identity there, read from the validated native ledger.
CliSession (core/src/cli/cli-session-types.ts:117–148) need not gain a new column:
readCliSession continues supplying association, readCliTokenBudget supplies the
fenced evidence. This is already how overlay plugin.mjs:139–142 persists both.

## Minimum interface delta

D1. Extend CodexNativeIdentity with selectedModel and selectedProvider, populated
ONLY from validated response.model/modelProvider. Thread/cwd/path validation
remains as-is. Carry this exact type through manager and task-session admit.

D2. Add optional bounded identity to CliTokenUsageWrite and
CliTokenLedger.identities[adapter:nativeSessionId]. Proposed value:

```ts
{
  selected?: { model: string; provider: string; source: 'codex-thread-start' };
  observed?: {
    model: string;
    provider?: string;
    source: 'codex-turn-context' | 'claude-assistant-message';
  };
}
```

Adapter/native/session identity is already in the validated key and owner; do
not accept a conflicting caller adapter. The observed field is backed by the
cursor/path/inode and that write's native observation, not a Boolean. Codex
requires selected.model === observed.model and selected.provider === actual
session_meta.model_provider. For Claude require nonempty message.model on each
post-baseline usage-bearing assistant response and consistent model for the
whole protected invocation. Keep returned selected identity distinct from
observed response/turn context. No configured fallback or guessed provider.

The small first slice should refuse a model/provider change, even within a
family, rather than silently crediting one reviewer identity for mixed calls.
Existing usage totals must not be reset or reassigned on refusal. Historical
baseline messages must not establish current-turn observed identity; select
post-baseline response evidence only. Legacy accounting without these optional
fields remains readable for budget purposes but is ineligible for automatic
merge review proof. Enforce no removal/rewrite of already persisted identity;
allow only selected→matching observed enrichment. Validate sizes/types and
existing namespace bounds in validateCliTokenLedger and the fenced writer.

D3. CliTokenBudgetInspection.session gains the same optional identity object.
No identity is returned as complete from awaiting-file/baseline or failed state.
Overlay native-accounting consumes it only after drained + matching native
session association. Automatic review eligibility uses existing
ws13/validator.mjs classifyModelFamily on observed.model, rejecting unknown or
same family for reviewer versus each actual author/correction contributor.
Configured model is a requested policy constraint to compare, never evidence.
Missing/changed observed identity refuses automatic admission while retaining
manual terminal behavior. Claude absent provider must remain explicitly absent;
if the approved policy requires transport provider identity as well as model
family, that provider input needs separate actual native evidence before enable.
Model family is not the same fact as provider routing.

## RED tests before implementation

R1. Real structured session fixture: returned model/provider differs from
configured -> admission fails before first turn. Matching return reaches the
existing fresh fenced write carrying exact native-selected fields. Native
session ID/cwd/path mismatch still refuses. Merely changing config cannot
manufacture observed identity.

R2. Actual observer/parser fixture: Codex session_meta provider + turn_context
model match handshake, then usage/drain yields matching identity. Missing or
changed header/turn model/provider, wrong session/inode or replacement/truncate
refuses. Claude same-session assistant usage preserves message.model; missing,
malformed, changed model or wrong native ID refuses. Baseline-only old model
with no fresh model must not authorize this turn. Duplicate message snapshots
remain idempotent and cannot rewrite identity.

R3. Existing fenced ledger PG suite extended by its owner: identity enrichment
and credits commit together; conflicting identity, Reset/new lease/session
mismatch, replay under another owner and transaction rollback preserve prior
identity/counters. No ledger clearing or second persistence service.

R4. Existing capability + overlay tests: matching session/native IDs and drained
observed evidence returns eligibility; awaiting-file, config-only model,
unknown/same family, mismatched identity and failed accounting refuse with zero
provider merge calls. A future resume cannot borrow old observed identity for
an unobserved turn. These tests do not claim Codex turn_context is the actual
provider response model, or Claude model prefix is transport-provider evidence.

Implementation owners must coordinate changes to the existing ledger module
with the active native worker. This plan does not change A2 step mutation or
R3 merge/reconcile/close ownership and authorizes no runtime canary.

## Approved implementation correction

Root approved top-level identity.coverage: complete | incomplete, absent until
post-baseline usage. Missing model charges usage and makes coverage incomplete;
incomplete never upgrades. Same trusted stream model drift charges the entire
bounded batch then persists a failed cursor and stops; wrong stream/lease refuses
attribution. Failed cursors cannot revive. No claim about later unobserved spend.
Claude correction retained at /private/tmp/claude/303-identity-claude-plan-review.md.
