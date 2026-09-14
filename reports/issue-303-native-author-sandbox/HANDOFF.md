# Native author sandbox handoff

Evidence mode: fallback committed source and real synthetic-child tests. Base: 7e55cf944123b1c7454eead3cc74ac8d3620ffbd. Branch: codex/303-native-author-sandbox. Scope: four native engine source files, two focused test files, changeset and this evidence directory. No agents overlay edits, installed CLI launch, inference, DB, auth/config mutation, integration or public push.

## Result

Closed native settings selector `codexSandbox: "task-worktree-write"` supports only fresh protected structured Codex task sessions. Task launch and manager refuse invalid selector, non-Codex, PTY, resume or missing native task/worktree context before fallback/session creation. Existing unselected behavior remains.

Thread/start canonicalizes the native worktree cwd and explicitly requests workspace-write, exactly that runtimeWorkspaceRoot, no extra writable roots, network disabled, both TMPDIR and slash-tmp exclusions. Model/provider selection and approval policy remain unchanged. Before onIdentity and usage admission, the actual returned policy must match workspaceWrite/network false/both exclusions true, exactly one canonical runtime root, and only empty or same-canonical-root extra writable roots. Only the installed-proven null activePermissionProfile is accepted; missing/named profiles fail closed. Existing thread cwd/model/identity validation remains. All failures kill the structured child and cannot send a prompt. No shared git administration root is granted.

## Reproduction and validation

Run from packages/engine:

- `node_modules/.bin/vitest run src/__tests__/codex-structured-handshake.test.ts src/__tests__/cli-codex-structured-pipeline.test.ts` — final-tests.log.gz: 40 PASS.
- `node_modules/.bin/vitest run src/__tests__/cli-token-budget-capability.test.ts src/__tests__/cli-fresh-codex-observer.test.ts src/__tests__/cli-token-budget-pipeline.test.ts` — accounting-regression.log.gz: 16 PASS.
- `node_modules/.bin/tsc --noEmit` — typecheck.log.gz: exit0.
- `node_modules/.bin/tsc` — build.log.gz: exit0, own worktree dist only.

Run from root:

- `node scripts/run-static-gate-checks.mjs` — static.log.gz: 16 validators PASS.
- `node scripts/check-changeset-format.mjs` — changeset-check-final.log.gz: exit0.
- Scoped eslint on the six changed TS files — lint.log.gz: exit0, zero errors; two test files are ignored by repository policy and reported as warnings. Four production files linted.
- `git diff --check` — exit0.

Dependency links used existing installed integration dependencies, no installation. Only own node_modules symlinks are removed before freeze; replay requires equivalent dependency wiring. No full release packaging or boot/runtime acceptance claimed.

## Negative evidence and limits

Before implementation, actual structured peer tests produced 14 failures/8 existing passes (red.log.gz): the request lacked containment and unsafe policies reached identity. Unsupported routing tests produced 4 failures/7 existing passes (routing-red.log.gz). Green now includes canonical symlink acceptance, symlink escape, wrong cwd/roots, missing policy/roots/profile/temporary exclusions, network enabled, unsupported sandbox types/profile, zero identity/turn on refusal, selected cancellation cleanup, PTY/resume/adapter refusal, and actual manager/task usage admission→drain.

Initial test command used repository cwd with package-relative Vitest includes and collected no tests; corrected to packages/engine before recording red evidence. Two test-edit commands used the wrong cwd and made no edit; corrected without source loss. An initial changeset checker filename did not exist (changeset-check.log.gz); package.json's canonical checker succeeded. These setup errors are not source failures.

The installed0.154 no-turn/OS denial receipts at /tmp/303-codex-permission-probe are prior root-owned evidence, not tests run by this patch. This slice confines opted-in Codex authors, not Claude validator/reviewer roles. Worktree git administration outside the root remains denied; host checkpoint/commit design belongs to a separate owner. No full graph, hosted PR/merge/close, or eight-check acceptance is inferred. Independent exact-source Claude review is root-owned and pending at freeze.
