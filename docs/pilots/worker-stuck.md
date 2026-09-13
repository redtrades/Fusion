# Graph pilot: worker-stuck and manual resume

Scope: [redtrades/agents#260](https://github.com/redtrades/agents/issues/260).
This is an opt-in, single-host pilot, not an installed dashboard watchdog.
It runs Fusion's `WorkflowGraphExecutor` with one command-backed agent node.
No LLM, inference endpoint, dashboard, database, or existing task is required.

## Start and observe

From a Fusion source checkout with `pnpm install --frozen-lockfile` complete:

```sh
mkdir -p /tmp/fusion-worker-pilot
pnpm exec tsx --conditions=source scripts/pilot-worker-watchdog.ts \
  /tmp/fusion-worker-pilot/attempt-1 -- node -e \
  'console.log("step 1"); setInterval(() => {}, 1000)'
```

The CLI prints the actual `agentPid`. In a second terminal, kill **only that
printed disposable PID** with `kill -9 PID`. Never identify the target by a
port, engine PID, or broad process-name search. Port 4040 is reserved.

The engine/harness stays alive and renews the lease every 100 ms even after
agent death. The independent observer timer samples every 100 ms against a
3,000 ms lease window. It checks the bound child lifetime (latched exit, with
OS PID probing as fallback), lease freshness, and a monotonic stdout byte
counter. Lease renewal and stderr do not count as agent progress.
The intentionally faulty pilot adapter leaves nonzero/signal exits pending,
reproducing the issue's lost completion notification. Exit 0 stops death
observation immediately, independently of start-notification latency, and allows
up to one lease window for output and notification completion to drain.
Excessive drain is a harness error, not `worker-stuck`.

A gone process with unchanged progress yields `worker-stuck`; a new progress
sample gets at most one observation to settle. After the first proven death,
worker progress freezes: further pipe/descendant bytes cannot extend its life.
Death is detected within two polls. A live or unknown process is never classified from inactivity alone.
Expired leases are recorded accurately and do not hide proven worker death.
PID reuse after an observed child exit cannot resurrect that bound attempt.
The timing guarantee assumes a schedulable host event loop, responsive local
storage. This pilot does not
monitor remote PIDs or an unresponsive engine.

The CLI returns exit **2** and prints `worker-stuck` for the lead. The attempt
folder contains atomic `state.json` and `lease.json` records, plus `agent.log`.
The state includes the attempt/node identity, dead PID, lease age/freshness,
progress counter/age, and observation time. Preserve these records. The graph
is cancelled before it can traverse its failure edge; no retry, recovery
node, restart, or new agent is dispatched. Exit 0 means completed, exit 1
means an error or graph failure. A storage/observer error is never reported
as successfully persisted `worker-stuck`. On setup, callback, or observer
error, the spawning harness cancels traversal and reaps only its captured
process group. This is error cleanup, not watchdog recovery; the observer
itself has no process-kill capability.

`worker-stuck` is terminal for the **pilot attempt**. It is not a new Fusion
TaskStore lifecycle column and does not move a live board card backwards.
The lead receives the CLI result and records disposition in the originating
issue/activity log. The watchdog itself sends no network messages.

## Manual resume procedure

1. Stop dispatch for the affected work item. Read the terminal `state.json`
   and `lease.json`; require `worker-stuck` for the expected attempt and node.
2. Preserve the entire attempt folder and agent log. If an integrated agent
   used a Git worktree, preserve dirty files, untracked files, commits and refs
   before any worktree cleanup. The pilot never removes or resets them.
3. Confirm the recorded agent PID is gone. Check for surviving descendants,
   supervisors that could resurrect it, and any successor already working on
   the same item. Resolve any collision before continuing. Never kill an
   unrelated process to satisfy this check.
4. Record the lead's explicit resume approval. Choose a **new** attempt
   directory and fresh agent invocation. Reconcile completed effects from
   the preserved log before choosing the remaining work. The pilot does not
   automatically replay, deduplicate, or resume the old model session.
5. Run the explicit successor command, for example:

   ```sh
   pnpm exec tsx --conditions=source scripts/pilot-worker-watchdog.ts \
     /tmp/fusion-worker-pilot/attempt-2 \
     --resume-from /tmp/fusion-worker-pilot/attempt-1 \
     --lead-approval 'lead-approved-resume' -- node -e \
     'console.log("remaining step complete")'
   ```

   The CLI refuses absent approval, a non-stuck predecessor, a PID that is
   alive/unknown, or an existing successor claim. It writes an exclusive
   `resumed-by.json` claim into the preserved predecessor directory before
   spawning. That claim fences duplicate pilot resumes; never overwrite it.
   If a claimed successor fails to start, preserve both directories and
   escalate to the lead; there is no automatic retry/claim reset.
6. Require successor exit 0, `state.json` state `completed`, and the expected
   output/artifact in `agent.log`. Check that the predecessor terminal state
   remains unchanged and no failure/recovery node ran.
7. Link the two attempt identities and verification result in the issue.
   If the successor becomes stuck again, stop and surface it to the lead.

## Integration point and limits

Runtime implementation lives in `packages/engine/src/pilot/`, with an
explicit source-only CLI in `scripts/pilot-worker-watchdog.ts`. The service
`observeGraphWorker` accepts a bound `ChildProcess`, attempt/node identity,
lease/progress reader and synchronous durable terminal writer. Its `race`
ends an otherwise pending agent operation; its abort signal fences graph
continuation. The supplied pilot wires it to `WorkflowGraphExecutor.handlers`
and the executor's top-level `signal`, and verifies a failure edge cannot run.

For a subsequent installed-runtime integration, bind the actual CLI child at
session spawn, sample `renewTaskLease` checkout freshness separately from
agent progress, and atomically park the same task/run/lease epoch before
cancelling the graph wait. `runGraphTaskStep` memoizes the implementation
promise, and `runGraphCustomNode` is the custom-node entrypoint. Neither
currently exposes a portable child PID through `AgentSessionResult`; do not
substitute the engine PID. Provider adapters and durable TaskStore fencing
are not changed by this pilot. Do not wire this to generic retry/self-healing.
Full fencing tokens across DB writes and branch pushes are required before
any future automatic recovery; the exclusive pilot successor claim is not
that distributed fencing protocol.

## Acceptance regression

```sh
pnpm --filter @fusion/engine exec vitest run \
  src/__tests__/graph-worker-watchdog.test.ts \
  src/__tests__/graph-worker-pilot.test.ts --silent=passed-only --reporter=dot
```

The integration test kills only a subprocess it created, drives the real
graph, verifies durable fresh-lease/dead-process/progress evidence within a
1,000 ms lease, checks no failure-edge dispatch, and follows the manual
resume sequence with a fresh command and preserved predecessor record.
