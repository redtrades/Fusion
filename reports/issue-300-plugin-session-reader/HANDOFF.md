# Issue 300 — project-scoped native session reader

Evidence mode: committed Fusion source plus deterministic local tests.
Owner: root-delegated OpenAI worker; scope recorded agents issue300 comment5657953174.
Base: 7f2d15b1378594bbbc548a3550c2b8a977133686.
Isolated worktree: /Users/man/worktrees/Fusion/300-plugin-session-reader.
No shared/integration tree edits, public pushes, inference, or live4040 changes.

Plan: reproduce missing capability in real PluginLoader lifecycle tests and native
reader tests; add only a late project-scoped read API, reuse existing shared loader
participants for management-first contexts, then verify and commit locally.

Contract: optional `PluginContext.readCliSession(sessionId)` resolves a detached
CliSession or undefined for unknown exact ID. Modern loader supplies a wrapper;
readiness is checked at invocation, not by typeof. Absent runtime, ambiguous owner,
failed flush, replaced runtime, wrong project or wrong ID reject. Native runtime
reader accesses its existing bundle.store only; no second hydrated cache, database
owner, enumeration, launch or write capability.

Management-first lifecycle: an onLoad context may precede the execution loader.
The reader looks up that same project/plugin's existing lifecycle participants on
every call. Discovery loaders stay isolated; route override stores cannot borrow
the original project's reader. Detaching the participant removes its availability.
Multiple distinct providers fail closed instead of guessing an owner.

Negative evidence: prior source failed3 loader tests and3 native reader tests
(`/tmp/fusion300-reader-core-red.log`, `/tmp/fusion300-reader-engine-red.log`).
A direct optional option captured only at context creation was rejected in design:
it would strand management-first plugin instances with no runtime reader.
Constructing a new CliSessionStore cache was rejected because it misses sessions
launched after hydration. Runtime store identity is checked again after flush so
shutdown/replacement during the wait cannot yield a stale-store read.

Dependencies installed with `pnpm install --offline --frozen-lockfile` (no
--ignore-scripts). No service startup used by this task.

Final verification (all exit 0):
- Core real loader lifecycle/route/single-load/isolation suite: 4 files, 14 tests.
  Command: pnpm --filter @fusion/core exec vitest run src/__tests__/plugin-loader-session-reader.test.ts src/__tests__/plugin-loader.route-context.test.ts src/__tests__/plugin-loader-single-load.test.ts src/__tests__/plugin-loader-lifecycle-scope.test.ts --reporter=dot
- Engine native reader/discovery isolation suite: 2 files, 6 tests.
  Command: pnpm --filter @fusion/engine exec vitest run src/__tests__/plugin-native-session-reader.test.ts src/__tests__/in-process-runtime-plugin-mcp-discovery-isolation.test.ts --project=engine-default --reporter=dot
- pnpm --filter @fusion/core build
- pnpm --filter @fusion/engine build
- pnpm --filter @fusion/engine typecheck
- pnpm exec eslint packages/core/src/plugins/plugin-types.ts packages/core/src/plugins/plugin-loader.ts packages/engine/src/runtimes/in-process-runtime.ts
- pnpm check:changesets
- git diff --check
Logs: /tmp/fusion300-reader-{core-final,engine-final,core-build,engine-build,engine-types-final,lint,changesets}.log.

Additional negative evidence: source inspection and added tests reproduced two
initial draft defects: retained execution context survived unload, and a foreign
TaskStore override could borrow another project's matching plugin reader. The
red run had 2 failures and 2 passes (/tmp/fusion300-reader-revocation-red.log).
Resolution checks the captured plugin instance is still installed in its owning
loader, requires the original project root, and only borrows from its own shared
lifecycle participants. Reload cannot revive a retained prior instance context.
An override to another root deliberately rejects even if that project has a live
reader: task routing alone does not transfer settings/permission-bound capability.
Calls begun before unload retain the already acquired read; subsequent calls are
revoked when the loader discards the instance. No new unload ordering is added.

Production execution PluginLoader receives createProjectCliSessionReader directly
in InProcessRuntime initialization; its getter reads this.cliAgentRuntime?.bundle.store
at invocation. Tests instantiate real PluginLoaders in both onLoad orders and
exercise the native helper with controlled store fixtures. This is not a service
boot/live-session acceptance test. Root retains independent review, integration,
and live pilot acceptance; no publication or live task mutation was performed.
