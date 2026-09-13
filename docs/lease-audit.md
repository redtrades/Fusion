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
The command only reads the file: no database, network, model, lease write,
GitHub comment or lifecycle action. Missing files return an empty history;
invalid JSON or an unsupported event schema fails visibly rather than
silently dropping observations. Copy the log from the controller host when
querying elsewhere. The function `readLeaseAuditHistory` is also available
in `packages/engine/src/util/lease-audit.ts` for an in-process lead.

## Interpreting the events

`claim_id` encodes `[task_id, worker_id, lease_epoch, node_id, run_id]`.
Each event includes that tuple, the ISO renewal timestamp `at`, observed
artifacts, and computed head/CI/review deltas. An absent run ID is `null`.
The underlying renewal API does not return an expiry timestamp, so the
observer does not invent one.

Only the GitHub observation mirror (`prInfos`, or the primary `prInfo`)
supplies artifact fields: PR URL, `headOid`, `checkRollup`,
`lastReviewDecision`, and `lastCheckedAt`. Those fields are populated by
the existing GitHub badge polling/refresh paths, for example
`packages/dashboard/src/github-poll.ts` and
`packages/dashboard/src/routes/register-git-github.ts`. There is no new
worker progress argument, self-reported counter, transcript inspection,
or progress attestation.

- `progressing`: at least one comparable head, CI or review field changed.
  This is an artifact change, not a claim that the work improved.
- `unchanged`: all three fields are known and unchanged for the same PR set.
- `spinning`: at least **three consecutive zero-delta renewals**. This is
  only a flag for the lead; it triggers no action.
- `unknown`: initial baseline, missing/partial evidence, changed PR set,
  unavailable observer, or stale evidence. Unknown resets the zero streak.

For a delta to count, every current PR observation must be newer than the
previous renewal and no later than this renewal. Reusing the same cached
GitHub sample never counts as a zero delta. Null review decisions count as
missing evidence. A new worker, epoch, node or run starts a separate history.
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

Rejected options: an agents-only contract would leave the real renewal
unobserved; worker counters would violate the scope; auto-pause and GitHub
audit-mirror comments would add unrequested behavior. A metrics service or
dashboard is unnecessary for the read-only claim join.

Next action: review the PR's exact revision and verification receipts, then
have the lead decide integration. No merge or release is part of this task.
