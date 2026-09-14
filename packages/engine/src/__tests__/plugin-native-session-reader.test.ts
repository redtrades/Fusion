import { describe, expect, it, vi } from "vitest";
import type { CliSession } from "@fusion/core";
import { createProjectCliSessionReader } from "../runtimes/in-process-runtime.js";

describe("project native CLI session reader", () => {
  it("late-resolves the live store, waits for durability and returns detached data", async () => {
    const record = { id: "exact", projectId: "project-a", autonomyPosture: { mode: "bounded" } } as unknown as CliSession;
    let release!: () => void;
    const flushed = new Promise<void>(resolve => { release = resolve; });
    const store = { flush: vi.fn(() => flushed), getSession: vi.fn(() => record) };
    let live: typeof store | undefined;
    const read = createProjectCliSessionReader("project-a", () => live);
    await expect(read("exact")).rejects.toThrow("unavailable");
    live = store;
    const pending = read("exact");
    expect(store.getSession).not.toHaveBeenCalled();
    release();
    const result = await pending;
    expect(store.getSession).toHaveBeenCalledWith("exact");
    expect(result).toEqual(record); expect(result).not.toBe(record);
    expect(result!.autonomyPosture).not.toBe(record.autonomyPosture);
    live = undefined;
    await expect(read("exact")).rejects.toThrow("unavailable");
  });

  it("refuses wrong-project rows and never reads after failed flush", async () => {
    const store = { flush: vi.fn(async () => {}), getSession: vi.fn(() => ({ id: "exact", projectId: "other" } as CliSession)) };
    const read = createProjectCliSessionReader("project-a", () => store);
    await expect(read("exact")).rejects.toThrow("project");
    store.getSession.mockClear();
    store.flush.mockRejectedValue(new Error("durability failure"));
    await expect(read("exact")).rejects.toThrow("durability failure");
    expect(store.getSession).not.toHaveBeenCalled();
  });

  it("refuses a runtime replaced while durability is pending", async () => {
    let release!: () => void;
    const oldStore = { flush: () => new Promise<void>(resolve => { release = resolve; }), getSession: vi.fn(() => undefined) };
    let live = oldStore;
    const read = createProjectCliSessionReader("project-a", () => live);
    const pending = read("exact");
    live = { flush: async () => {}, getSession: vi.fn(() => undefined) };
    release();
    await expect(pending).rejects.toThrow("runtime changed");
    expect(oldStore.getSession).not.toHaveBeenCalled(); expect(live.getSession).not.toHaveBeenCalled();
  });

  it("returns no record for an unknown exact ID", async () => {
    const store = { flush: vi.fn(async () => {}), getSession: vi.fn(() => undefined) };
    await expect(createProjectCliSessionReader("project-a", () => store)("missing")).resolves.toBeUndefined();
  });
});
