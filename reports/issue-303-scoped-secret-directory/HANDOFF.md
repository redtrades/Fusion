# Scoped native secrets directory

Scope: agents7302ee7 approval, Fusion base2de54a3f7e80fa779ea8b41d988b9f37a7aa7b5e. Only production delta forwards store.globalSettingsDir to MasterKeyManager. VITEST guard, key policy, cached factory and other runtime paths unchanged. No Pi retry authorized/executed.

## Symptom Verification

Original symptom: actual registered native Pi setup failed in runImplementation → MCP resolution → TaskStore.getSecretsStore → MasterKeyManager → resolveGlobalDir because the factory discarded the directory already held by TaskStore.

Actual canonical PG test first failed twice at the same explicit-dir guard. Minimal fix then passed both cases: default test-scoped directory and explicitly supplied directory. Constructor initialization can eagerly cache the SecretsStore, so the directory observer starts before TaskStore initialization. First GREEN attempt caught that fixture observation ordering (1pass/1failure); moving the observer before initialization preserved the real constructor and assertions. Raw evidence retained; no runtime guard weakened.

Tests verify returned native SecretsStore empty metadata listing, scoped-directory forwarding through real resolveGlobalDir, cached second access, and zero calls to a throwing getOrCreateKey sentinel. No real Keychain/key/credential operation is used. Existing MasterKeyManager controls use injected fake Keychain providers and passed11tests.

## Surface Enumeration

Shared getSecretsStoreImpl covers backend/native TaskStore and its cache. Both derived and explicit globalSettingsDir are covered. Omitted directory outside tests retains MasterKeyManager's existing default behavior; no global default/policy change. Legacy nonbackend central construction is unmodified and not exercised here. Keychain isolation itself is not claimed by directory propagation.

## Validation

- Real ephemeral PG regression:2PASS, original2RED retained.
- Existing MasterKeyManager tests:11PASS.
- Core tsc --noEmit:PASS.
- Production-file ESLint:PASS; test file is ignored by repository ESLint config (1warning,0errors).
- git diff --check:PASS.
- Full gate/build not run: scope is private-core argument propagation, root owns integration verification.

Exact commands and runner/config are gzip-retained in evidence. PG: `node /tmp/303-scoped-secret-directory-proof/run.mjs` (runner pins baseHEAD, expects the tested local diff). Unit: `packages/core/node_modules/.bin/vitest run --config /tmp/303-scoped-secret-directory-proof/master-key.config.mts --reporter=verbose`. Typecheck: `node_modules/.bin/tsc --noEmit -p packages/core/tsconfig.json`. Lint: `node_modules/.bin/eslint packages/core/src/task-store/workflow-definitions.ts packages/core/src/__tests__/postgres/task-store-secrets-directory.test.ts`.

Root replay can use retained runner after changing only its expected source/root/output paths to the independently reviewed composition; those are environment, not native execution replacements. Native test source uses relative imports. No dependencies installed; borrowed dependency symlinks removed before freeze.

Owned PG stopped normally; endpoint closed; RED and finalGREEN parent/worker/PG identities absent (cleanup.json). No live4040/KB003/global settings/auth/model/network-provider changes, no public push. Independent exact-source Claude review and integration remain root-owned; no PASS claimed for that gate.
