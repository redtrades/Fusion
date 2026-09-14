import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginLoader } from "../plugins/plugin-loader.js";
import type { PluginContext, PluginInstallation, PluginLoaderOptions } from "../index.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const release of cleanup.splice(0).reverse()) await release(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "fusion-plugin-session-reader-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "plugin.mjs");
  await writeFile(path, `const plugin = { manifest: { id: "reader", name: "Reader", version: "1.0.0", description: "fixture" }, hooks: { onLoad(ctx) { plugin.captured = ctx; } } }; export default plugin;`);
  const installation = { id: "reader", name: "Reader", version: "1.0.0", description: "fixture", path, enabled: true, state: "installed", settings: {}, dependencies: [], createdAt: "", updatedAt: "" } as PluginInstallation;
  const pluginStore = { getPlugin: vi.fn(async () => ({ ...installation })), updatePluginState: vi.fn(async () => undefined) };
  const taskStore = { getRootDir: () => root, preflightPluginSchema: () => null, runPluginSchemaInits: async () => undefined, recordPluginActivation: () => undefined };
  const create = (extra: Partial<PluginLoaderOptions> = {}) => {
    const loader = new PluginLoader({ pluginStore: pluginStore as any, taskStore: taskStore as any, ...extra });
    cleanup.push(() => loader.stopPlugin("reader"));
    return loader;
  };
  return { root, create, taskStore };
}

describe("PluginLoader native session reader lifecycle", () => {
  it.each([true, false])("uses the execution reader when management loads first: %s", async managementFirst => {
    const f = await fixture();
    const read = vi.fn(async id => ({ id, projectId: "project-a" }));
    const management = f.create();
    const execution = f.create({ readCliSession: read as any });
    const first = managementFirst ? management : execution;
    const second = managementFirst ? execution : management;
    await first.loadPlugin("reader");
    const captured = (first.getPlugin("reader") as any).captured as PluginContext;
    if (managementFirst) await expect(captured.readCliSession!("exact-id")).rejects.toThrow("unavailable");
    await second.loadPlugin("reader");
    expect(second.getPlugin("reader")).toBe(first.getPlugin("reader"));
    await expect(captured.readCliSession!("exact-id")).resolves.toEqual({ id: "exact-id", projectId: "project-a" });
    expect(read).toHaveBeenCalledWith("exact-id");
    await execution.stopPlugin("reader");
    await expect(captured.readCliSession!("exact-id")).rejects.toThrow("unavailable");
  });

  it("does not revive a retained context when the plugin is loaded again", async () => {
    const f = await fixture();
    const read = vi.fn(async () => undefined);
    const execution = f.create({ readCliSession: read });
    await execution.loadPlugin("reader");
    const retained = (execution.getPlugin("reader") as any).captured as PluginContext;
    await execution.stopPlugin("reader");
    await execution.loadPlugin("reader");
    await expect(retained.readCliSession!("exact")).rejects.toThrow("unavailable");
    const current = (execution.getPlugin("reader") as any).captured as PluginContext;
    await expect(current.readCliSession!("exact")).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("late-resolves native accounting capability and revokes it with the participant", async () => {
    const f = await fixture();
    const management = f.create();
    const inspect = vi.fn(async () => ({ protocol: "native-cli-observed-v1", hardLimit: 10, observedWorkTokens: 0, launchGate: "authenticated-identity-before-prompt" }));
    const execution = f.create({ readCliTokenBudget: inspect as any });
    await management.loadPlugin("reader");
    const context = (management.getPlugin("reader") as any).captured as PluginContext;
    const input = { taskId: "task", adapterId: "codex" as const, admission: { runId: "run", leaseEpoch: 1, agentId: "agent", nodeId: "host" } };
    await expect(context.readCliTokenBudget!(input)).rejects.toThrow("unavailable");
    await execution.loadPlugin("reader");
    await expect(context.readCliTokenBudget!(input)).resolves.toMatchObject({ protocol: "native-cli-observed-v1" });
    expect(inspect).toHaveBeenCalledWith(input);
    await execution.stopPlugin("reader");
    await expect(context.readCliTokenBudget!(input)).rejects.toThrow("unavailable");
  });

  it("refuses two different execution readers instead of selecting an owner arbitrarily", async () => {
    const f = await fixture();
    const management = f.create();
    const firstRead = vi.fn(async () => undefined), secondRead = vi.fn(async () => undefined);
    const first = f.create({ readCliSession: firstRead });
    const second = f.create({ readCliSession: secondRead });
    await management.loadPlugin("reader"); await first.loadPlugin("reader"); await second.loadPlugin("reader");
    const context = (management.getPlugin("reader") as any).captured as PluginContext;
    await expect(context.readCliSession!("exact")).rejects.toThrow("ambiguous");
    expect(firstRead).not.toHaveBeenCalled(); expect(secondRead).not.toHaveBeenCalled();
  });

  it("does not borrow another project's or isolated discovery loader's reader", async () => {
    const a = await fixture(), b = await fixture();
    const read = vi.fn(async id => ({ id }));
    const owner = a.create({ readCliSession: read as any });
    const foreignRead = vi.fn(async () => undefined);
    const foreign = b.create({ readCliSession: foreignRead });
    const discovery = a.create({ lifecycleScope: "isolated" });
    await owner.loadPlugin("reader"); await foreign.loadPlugin("reader"); await discovery.loadPlugin("reader");
    for (const loader of [discovery]) {
      const context = (loader.getPlugin("reader") as any).captured as PluginContext;
      await expect(context.readCliSession!("exact-id")).rejects.toThrow("unavailable");
    }
    const overridden = await owner.createRouteContext("reader", { taskStore: b.taskStore as any });
    await expect(overridden.readCliSession!("exact-id")).rejects.toThrow("unavailable");
    expect(read).not.toHaveBeenCalled();
    expect(foreignRead).not.toHaveBeenCalled();
  });
});
