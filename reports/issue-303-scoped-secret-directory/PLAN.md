# Scoped secrets directory repair

Evidence mode: actual failed isolated Pi setup and native source. Approved agents7302ee7 scoped-directory plan. Base2de54a3f7e80fa779ea8b41d988b9f37a7aa7b5e.

Only production change: pass existing TaskStore.globalSettingsDir to MasterKeyManager in getSecretsStoreImpl. Do not alter VITEST guard, cached factory, credential policy, key-provider invocation, central store, or Pi runtime.

Public seam: actual TaskStore.getSecretsStore over canonical ephemeral PG fixture. Regression covers fixture-derived and explicit scoped directory, repeated cached access, empty metadata listing, and zero lazy key-provider calls. The resolver observation calls through to real resolveGlobalDir; getOrCreateKey is a throwing sentinel preventing real Keychain/filesystem credential access. RED first must be original explicit-dir exception. Then minimal fix, focused PG/master-key controls and core typecheck/lint. Preserve raw evidence and exact commit for independent review; no Pi retry.
