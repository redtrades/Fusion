# Task-only canary budget provisioning (prepared, not executed)

Root executes exclusively. The real preflight receipt preflight-1789364587636.json confirms KB-002, unchanged run/lease/head, observed usage0, and absent task/project/global budgets. User-authorized target is a task-only hard override50000 observed work tokens. The script does not change project/global settings, account subscription, model, auth, trust, columns, run ownership or task execution.

Existing supported mutation exists: TaskStore.updateTaskAtomic callback → updateTaskUnlocked, with tokenBudgetOverride accepted by TaskStore.updateTask. Source: packages/core/src/store.ts updateTask/updateTaskAtomic and task-store/task-mutation-ops.ts381–388. This is a process-lock guard, not a cross-process CAS; root's verified exclusive isolated-database ownership remains required. No SQL/JSON database edit or invented setter is used.

Review budget.mjs and run-budget.mjs. Syntax checks pass; no store or child was opened during preparation.

Commands (root only):

- Read-only default: `/Users/man/.hermes/node/bin/node /tmp/303-structured-native-canary/run-budget.mjs`
- Explicit apply: same command with `--apply`.
- Conditional cleanup: same command with `--restore`.

All modes enforce isolated HOME, pinned integrated source/compiled entry hashes, exact project/task/source issue/current lease and native worktree/head. Apply requires an absent override, no non-dead project native CLI records, no active canary/runner process, and a new exclusive provisioning receipt. The setter's callback repeats current task/lease/override checks under the native process lock. It changes only tokenBudgetOverride to {hard:50000}; verifies the native value and unchanged project/global settings.

The provisioning journal preserves previousOverride:null exactly and records the successful native write. Restore requires this matching applied journal, unchanged task/lease/head, no active native sessions/canary, and the exact current {hard:50000} with no extra fields. It restores null through the same supported setter; a differing override, stale owner or ambiguous/unconfirmed write refuses cleanup rather than clobbering another edit. A crash after an unconfirmed apply needs root reconciliation; the script does not guess.

After apply, root sets canary control.expectedHardLimit to50000 and reruns the read-only canary preflight. Request authorization remains false until root reviews the no-turn receipt/execution controls. After the native canary has fully exited, use --restore and verify native preflight returns source:none/null budgets again. Do not remove real usage or native CLI audit records. A hard-limit pause, if one occurred, is not automatically cleared by budget restoration.

Each operation writes a unique metadata receipt and shuts down its owned isolated backend. No public push, live4040/KB003, auth/config/trust mutation or inference is performed by this script.
