import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTaskStoreForTest } from "../../__test-utils__/pg-test-harness.js";
import * as globalSettings from "../../config/global-settings.js";
import { MasterKeyManager } from "../../secrets/master-key.js";
import { TaskStore } from "../../store.js";

afterEach(() => vi.restoreAllMocks());

it.each(["fixture", "explicit"] as const)("keeps the %s TaskStore directory and creates secrets lazily", async (mode) => {
  const keyAccess = vi.spyOn(MasterKeyManager.prototype, "getOrCreateKey").mockImplementation(async () => {
    throw new Error("This factory test must never access a master key");
  });
  const resolver = vi.spyOn(globalSettings, "resolveGlobalDir");
  const h = await createTaskStoreForTest({ prefix: "scoped_secrets" });
  try {
    const store = mode === "fixture"
      ? h.store
      : new TaskStore(h.rootDir, join(h.rootDir, "explicit-secrets-settings"), { asyncLayer: h.layer });
    const directory = store.globalSettingsDir;
    expect(directory).toBeTruthy();
    expect(process.env.VITEST).toBe("true");
    const secrets = await store.getSecretsStore();
    expect(resolver).toHaveBeenCalledWith(directory);
    expect(await secrets.listSecrets()).toEqual([]);
    resolver.mockClear();
    expect(await store.getSecretsStore()).toBe(secrets);
    expect(resolver).not.toHaveBeenCalled();
    expect(keyAccess).not.toHaveBeenCalled();
  } finally {
    await h.teardown();
    expect(keyAccess).not.toHaveBeenCalled();
  }
});
