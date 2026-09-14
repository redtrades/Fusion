# O1 native task merge requester proof

Evidence mode: fallback evidence (exact source and isolated real PostgreSQL). Test/report-only scope authorized by the issue-300 coordinator; no production behavior change.

Base: `379c94d5e7c3bb824baf9b5c3705781904848c36`. Worktree: `/Users/man/worktrees/Fusion/303-task-merge-route-proof`.

## Measured result

Six tests: **2 PASS, 4 intentional RED**, no skips. The red tests state the required safe behavior and remain failing; this is not a passing implementation.

- PASS: real ProjectEngine requestInterpreterMerge → onMerge → queue/admission → injected public processPullRequestMergeTask waits while the intercepted PR remains open. Task stays in-review, source close count zero. An authoritative provider response of merged then takes the existing native completion path to done and the actual GitHubSourceIssueCloseService closes once. Requester replay declines a done task; close count remains one, no second PR is created.
- PASS: explicit caller cancellation during the provider status await prevents provider merge and source close.
- RED: the existing PR entity retains selected/reviewed head A, refresh returns B, native-auto disabled: provider merge is invoked once with expectedHeadOid **B**, not A.
- RED: same head drift with native-auto enabled: provider merge is invoked once with **auto:true**, no expectedHeadOid.
- RED: actual resetTaskPublication to the same review column during provider status await still permits one provider merge request.
- RED: actual tryClaimCheckout takeover from checkout-A/epoch1 to checkout-B/epoch2 during provider status await still permits one provider merge request.

The last two races include the actual ProjectEngine wireAutoMerge and wireTaskPauseMergeInterruption event handlers. They do not rely on omitting those listeners. The cancellation control distinguishes the missing automatic ownership fence from a broken explicit AbortSignal path.

## Test boundaries and setup

Real: isolated PG TaskStore, selected custom native IR with intake/WIP/merge/complete columns and review/merge-attempt/end nodes; one immutable proposal claim; existing Task.prInfo and real PR entity; native checkout CAS and Reset publication; actual ProjectEngine constructor, requester, queue, admission coordinator, merge callback, lifecycle completion; actual issue-close listener.

Intercepted: git child-process I/O, GitHub PR provider, issue auth resolution, and GitHub issue provider. The temporary worktree directory belongs to the PG fixture. No remote mutation, model call, credentials read, live service, or production database occurred. PG was stopped in the runner's finally block.

The fixture initializes preexisting implementation checklist completion through native updateStep. That is a prerequisite, **not evidence that implementation or review ran**. The selected graph is persisted but is not executed by TaskExecutor; the workflow primitive boundary and full scheduler are not covered. Runtime start is omitted; its getTaskStore accessor is attached to the actual isolated store and the merge lane is enabled for this component test. No onMerge/drain/finalizer implementation is replaced, and no mergeConfirmed, task done, or PR-merged status is manually manufactured as proof. The real task processor consumes the provider's merged response. PR entity mirror reconciliation remains separate from this route.

## Reproduction

With workspace dependency links available, run:

```sh
node /tmp/303-task-merge-route-run.mjs
```

The recorded runner/config are copied alongside this handoff. They deliberately name this isolated worktree and the integration dependency executable. The Vitest source aliases come from this worktree's core config. The test runner allocates its own ephemeral TCP port and temporary PostgreSQL data directory. Read the Vitest summary: embedded-postgres shutdown can mask the child exit status at the outer process boundary.

Final raw output is `red.log`: 4 failed, 2 passed, 6 total; isolated database stopped. `git diff --check` passes. No package-wide typecheck/build is claimed for this test-only slice. Dependency symlinks were removed before freezing and are not committed.

## Negative evidence and next action

Initial fixture failures were invalid review trait, missing branch provenance, pending auto-generated checklist steps, and an unregistered fake git worktree path. Those were fixture construction errors, not product findings. An initial listener cleanup failure also masked assertions; both actual merge listener groups are now attached and removed. The final six-test output contains none of those fixture failures.

Keep the completion service unchanged. Carry the already-declared MergePrimitiveInput.expectedHeadOid and an immutable native checkout snapshot through the existing requester/queue/callback chain; add pre-provider current-owner/cancellation checks and protect confirmation/finalization against the same stale operation. New automatic graph bindings must require the protected options. Existing callers without them retain existing behavior. See the bounded follow-up plan supplied to the coordinator; no production fix is part of this revision.
