# Executor lease renewal audit

WS 1.12 / [redtrades/agents#261](https://github.com/redtrades/agents/issues/261)
adds observation only. Every successful `renewTaskLease` call attempts one
append-only JSONL event at `<task-directory>/lease-audit.jsonl`. Both the
AgentStore and TaskStore fallback paths emit after the lease write succeeds.
Rejected renewals do not emit success. Lease ownership, renewal cadence,
scheduling, pause and enforcement remain unchanged.

## Lead query

From a Fusion source checkout:

```sh
pnpm exec tsx scripts/lease-audit.ts /path/to/task/lease-audit.jsonl
pnpm exec tsx scripts/lease-audit.ts /path/to/task/lease-audit.jsonl '["FN-261","worker-1",3,"node-1","run-1"]'
```

The JSON result groups renewal history by `claim_id`, with the latest status
beside each group. The optional second argument selects exactly one claim.
The command only reads the file: no database query, network, model, lease write,
GitHub comment or lifecycle action. Missing files return an empty history;
invalid JSON or an unsupported event schema fails visibly rather than
silently dropping observations. Copy the log from the controller host when
querying elsewhere. The function `readLeaseAuditHistory` is also available
in `packages/engine/src/util/lease-audit.ts` for an in-process lead.

## Interpreting the events

`claim_id` encodes `[task_id, worker_id, lease_epoch, node_id, run_id]`.
Each event includes that tuple, the ISO renewal timestamp `at`, observation
completion timestamp `observed_at`, external artifacts, and computed
head/CI/review deltas. An absent run ID is `null`.
The underlying renewal API does not return an expiry timestamp, so the
observer does not invent one.

The task supplies only linked PR URLs (`prInfos`, or primary `prInfo`). The
observer uses Fusion's existing `runGhJsonAsync` adapter to read each PR's
`headRefOid`, `statusCheckRollup`, and `reviewDecision` directly from GitHub
on every renewal. CI fields are normalized and sorted, excluding timestamps
and output prose; an empty check list and an empty review decision are known
“none” states. There is no worker progress argument, self-reported counter,
transcript inspection, or progress attestation. Stored badge progress fields
are never trusted as observations.

The controller needs authenticated `gh` access. Missing auth, API failure,
timeout, unsupported PR URLs, or incomplete responses yield unknown. Only
HTTPS `github.com` PR URLs are supported in this slice. The query CLI itself
still reads only the log and makes no network requests.

- `progressing`: at least one comparable head, CI or review field changed.
  This is an artifact change, not a claim that the work improved.
- `unchanged`: all three fields are known and unchanged for the same PR set.
- `spinning`: at least **three consecutive zero-delta renewals**. This is
  only a flag for the lead; it triggers no action.
- `unknown`: initial baseline, missing/partial evidence, changed PR set,
  unavailable observer, or stale evidence. Unknown resets the zero streak.

For a delta to count, every current PR observation must be newer than the
previous observation and no later than this observation. Cached dashboard
badge data never counts as a sample: its 60-second polling loop does not
persist unchanged results, whereas lease renewals run every 30 seconds.
Null/missing review fields count as missing evidence. A new worker, epoch, node or run starts a separate history.
An executor with no PR yet remains unknown; this slice makes no claim about
unpublished local work.

## Durability and limits

Events append with one JSONL line per write; existing bytes are not rewritten.
Appends serialize per task file within one controller process and read the
prior claim event from disk, so ordinary process restarts preserve the streak.
The file is controller-local; it is not a distributed or transactional lease
ledger. Multiple controllers writing the same claim concurrently are not
supported for streak calculation. All claim events remain queryable in the file.

The artifact read and file sink use the existing bounded audit seam: up to
two seconds for artifact collection and four seconds for the whole observer.
Each read-only gh subprocess additionally has a 1.5-second timeout. At the
current 30-second renewal cadence this adds up to two queries per minute per
linked PR; rate limits degrade observations to unknown rather than affect work.
Failures/timeouts warn through the run-audit logger and cannot reject a
successful lease renewal. A missing/hanging artifact reader yields unknown;
an unavailable file sink can lose an event. A crash between the lease write
and the audit append can also lose an event. This is best-effort telemetry,
not an atomic progress-attestation protocol. Corrupt logs are reported rather
than repaired or truncated automatically. No retention or GitHub mirror is added.

## Placement and handoff

Evidence mode: fallback evidence from the current GitHub issue and comments,
the supplied 2026-09-13 research file, and Fusion source at base
`2fd2432092f9ba3092e5939f46ca6267295f08ed`.

Fusion is a Git repository (`redtrades/Fusion`), and the actual renewal
function lives in `packages/engine/src/executor/renew-task-lease.ts`.
The implementation therefore belongs in Fusion, targeting its `main` through
branch `ws112-lease-audit-261`. No agents procedure-engine surrogate or Fusion
deployment is required to review this change. The source-checkout integration
is wired; deployed runtime acceptance remains unverified.

Negative evidence: `gh issue view` returned HTTP 401, including with token
environment overrides removed. The connected GitHub reader succeeded and
confirmed the lead's Codex ownership correction. The agents checkout's
`git pull --ff-only` failed for HTTPS authentication; its local changes and
governing files were left untouched. Fusion's `origin/main` fetch succeeded.
Offline dependency install lacked one cached tarball; the frozen-lockfile
online install succeeded without running package scripts. The pre-change
renewal tests passed (2); the first two audit tests failed for the expected
missing JSONL file. No local-model inference was used.

Separate code review rejected revision `be598480e`: its dashboard cache
could not supply fresh unchanged samples at renewal cadence. The correction
queries GitHub directly and tests four 30-second renewals while the stored
PR mirror stays stale. This review does not replace the lead's required
different-model-family review.

Rejected options: an agents-only contract would leave the real renewal
unobserved; worker counters would violate the scope; auto-pause and GitHub
audit-mirror comments would add unrequested behavior. A metrics service or
dashboard is unnecessary for the read-only claim join.

Next action: review the PR's exact revision and verification receipts, then
have the lead decide integration. No merge or release is part of this task.

## Verification receipt (2026-09-13)

- 27 tests pass across `lease-audit.test.ts`, `executor-lease-renewal.test.ts`,
  and `emit-bounded-run-audit.test.ts` (`engine-default` project).
- Engine typecheck and build pass; scoped production/script ESLint,
  changeset format, FNXC timestamps, and `git diff --check` pass.
- The fresh-process query test reads a populated history and verifies that
  its bytes are unchanged. The source-checkout smoke initially exposed a
  missing core build dependency; lazy loading the observation-only GitHub
  adapter fixes the query without requiring a core build.
- Separate code review rejected the cached-sample implementation, then
  confirmed the cadence correction at `ce05ba3c1`. Required
  different-model-family acceptance remains pending with the lead.
- HTTPS push failed for missing credentials. SSH pushed the branch to
  `redtrades/Fusion`; the connected GitHub API opened
  [PR #1](https://github.com/redtrades/Fusion/pull/1) and posted its link to
  agents issue #261. No PR-triggered workflow runs were returned for
  `ce05ba3c1`; full merge gate and authenticated deployed-runtime acceptance
  remain unverified. No local-model inference occurred.
