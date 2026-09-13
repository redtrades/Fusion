import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenewTaskLeaseDeps } from "../executor/renew-task-lease.js";
import { renewTaskLease } from "../executor/renew-task-lease.js";
import { readLeaseAuditHistory } from "../util/lease-audit.js";
const { ghRead } = vi.hoisted(() => ({ ghRead: vi.fn() }));
vi.mock("@fusion/core", () => ({ runGhJsonAsync: ghRead }));

describe("lease renewal observation", () => {
  let dir: string;
  let deps: RenewTaskLeaseDeps;
  let pr: Record<string, unknown>;
  const renew = () => renewTaskLease(deps, "FN-261", "worker-1", 3, "node-1", "run-1");
  const events = async () => (await readFile(join(dir, "lease-audit.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lease-audit-"));
    pr = { url: "https://github.com/example/repo/pull/1", headOid: "a".repeat(40),
      checkRollup: "pending", lastReviewDecision: "REVIEW_REQUIRED",
      lastCheckedAt: new Date().toISOString() };
    ghRead.mockReset().mockImplementation(async () => ({ headRefOid: pr.headOid,
      reviewDecision: pr.lastReviewDecision,
      statusCheckRollup: pr.checkRollup ? [{ __typename: "CheckRun", name: "test", status: pr.checkRollup }] : null }));
    deps = {
      store: { renewCheckoutLease: vi.fn().mockResolvedValue(undefined),
        getTaskDir: () => dir, getTask: vi.fn(async () => ({ prInfo: {
          url: "https://github.com/example/repo/pull/1", headOid: "worker-report-is-ignored",
          lastCheckedAt: "2000-01-01T00:00:00Z",
        } })),
        updateTask: vi.fn() } as unknown as RenewTaskLeaseDeps["store"],
      options: {}, getRunContextFor: () => undefined,
    };
  });
  afterEach(async () => { vi.useRealTimers(); await rm(dir, { recursive: true, force: true }); });

  it.each([false, true])("appends one correlated event on successful renewal (agent store: %s)", async (agentStore) => {
    if (agentStore) deps.options.agentStore = { checkoutTask: vi.fn().mockResolvedValue({}) } as never;
    await renew();
    const [event] = await events();
    expect(await events()).toHaveLength(1);
    expect(event).toMatchObject({ event: "lease_renewed", task_id: "FN-261", worker_id: "worker-1",
      lease_epoch: 3, node_id: "node-1", run_id: "run-1", at: expect.any(String),
      progress: { status: "unknown", zero_delta_streak: 0 } });
    expect(deps.store.updateTask).not.toHaveBeenCalled();
  });

  async function tick() {
    vi.setSystemTime(Date.now() + 30_000);
    await renew();
  }

  it("flags exactly three zero deltas, resets on head/CI/review changes, and keeps renewing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await renew();
    await tick(); await tick();
    expect((await events()).at(-1).progress).toMatchObject({ status: "unchanged", zero_delta_streak: 2 });
    await tick();
    expect((await events()).at(-1).progress).toMatchObject({ status: "spinning", zero_delta_streak: 3 });
    const prefix = await readFile(join(dir, "lease-audit.jsonl"), "utf8");
    pr.headOid = "b".repeat(40); await tick();
    expect((await events()).at(-1).progress).toMatchObject({ status: "progressing", pr_head_changed: true, zero_delta_streak: 0 });
    pr.checkRollup = "success"; await tick();
    expect((await events()).at(-1).progress.ci_state_changed).toBe(true);
    pr.lastReviewDecision = "APPROVED"; await tick();
    expect((await events()).at(-1).progress.review_state_changed).toBe(true);
    expect((await readFile(join(dir, "lease-audit.jsonl"), "utf8")).startsWith(prefix)).toBe(true);
    expect(deps.store.renewCheckoutLease).toHaveBeenCalledTimes(7);
    expect(deps.store.updateTask).not.toHaveBeenCalled();
  });

  it("does not call unavailable or partial external evidence spinning", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await renew();
    ghRead.mockRejectedValue(new Error("unauthenticated"));
    for (let i = 0; i < 4; i++) await tick();
    expect((await events()).at(-1).progress.status).toBe("unknown");
    ghRead.mockResolvedValue({ headRefOid: pr.headOid });
    for (let i = 0; i < 4; i++) await tick();
    expect((await events()).at(-1).progress).toMatchObject({ status: "unknown", zero_delta_streak: 0 });
    deps.store.getTask = vi.fn().mockResolvedValue({ progress: "I am progressing", prInfos: [] });
    await tick();
    expect((await events()).at(-1).artifacts).toEqual([]);
    expect((await events()).at(-1).progress.status).toBe("unknown");
  });

  it("samples each 30-second renewal even when unchanged dashboard data is never persisted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await renew(); await tick(); await tick(); await tick();
    expect(ghRead).toHaveBeenCalledTimes(4);
    expect(ghRead).toHaveBeenLastCalledWith(["pr", "view", "1", "--repo", "example/repo",
      "--json", "headRefOid,statusCheckRollup,reviewDecision"], { timeoutMs: 1_500 });
    const last = (await events()).at(-1);
    expect(last.progress).toMatchObject({ status: "spinning", zero_delta_streak: 3 });
    expect(last.artifacts[0].head).toBe("a".repeat(40));
    expect(deps.store.updateTask).not.toHaveBeenCalled();
  });

  it("ignores check ordering and counts a fresh empty review/check result as known", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const checks = [{ name: "a", status: "COMPLETED", conclusion: "SUCCESS" },
      { context: "b", state: "SUCCESS" }];
    ghRead.mockResolvedValue({ headRefOid: "a".repeat(40), reviewDecision: "", statusCheckRollup: checks });
    await renew();
    ghRead.mockResolvedValue({ headRefOid: "a".repeat(40), reviewDecision: "", statusCheckRollup: [...checks].reverse() });
    await tick();
    expect((await events()).at(-1).progress).toMatchObject({ status: "unchanged", ci_state_changed: false });
    ghRead.mockResolvedValue({ headRefOid: "a".repeat(40), reviewDecision: "", statusCheckRollup: [] });
    await tick();
    expect((await events()).at(-1).progress.status).toBe("progressing");
  });

  it("joins each claim read-only and does not carry streaks across epochs or runs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await renew(); await tick(); await tick(); await tick();
    const first = (await events())[0].claim_id;
    await renewTaskLease(deps, "FN-261", "worker-1", 4, "node-1", "run-1");
    await renewTaskLease(deps, "FN-261", "worker-1", 4, "node-1", "run-2");
    const file = join(dir, "lease-audit.jsonl");
    const before = await readFile(file, "utf8");
    expect(await readLeaseAuditHistory(file, first)).toHaveLength(4);
    expect((await readLeaseAuditHistory(file)).slice(-2).map((e) => e.progress.status)).toEqual(["unknown", "unknown"]);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readLeaseAuditHistory(join(dir, "missing"))).toEqual([]);
  });

  it("serializes concurrent appends without losing renewals", async () => {
    await Promise.all(Array.from({ length: 10 }, renew));
    expect(await events()).toHaveLength(10);
  });

  it("runs the lead query in a fresh process without loading runtime build artifacts", async () => {
    await renew();
    const file = join(dir, "lease-audit.jsonl");
    const before = await readFile(file, "utf8");
    const claim = (await events())[0].claim_id;
    const { stdout } = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url)),
      fileURLToPath(new URL("../../../../scripts/lease-audit.ts", import.meta.url)), file, claim,
    ]);
    expect(JSON.parse(stdout)).toMatchObject({ observation_only: true,
      claims: [{ claim_id: claim, status: "unknown", renewals: [{ event: "lease_renewed" }] }] });
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it.each([false, true])("does not emit success if renewal rejects (agent store: %s)", async (agentStore) => {
    if (agentStore) deps.options.agentStore = { checkoutTask: vi.fn().mockRejectedValue(new Error("conflict")) } as never;
    else deps.store.renewCheckoutLease = vi.fn().mockRejectedValue(new Error("conflict"));
    await expect(renew()).rejects.toThrow("conflict");
    expect(await readLeaseAuditHistory(join(dir, "lease-audit.jsonl"))).toEqual([]);
  });

  it("records unknown evidence if the artifact store rejects", async () => {
    deps.store.getTask = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(renew()).resolves.toBeUndefined();
    expect((await events())[0].progress.status).toBe("unknown");
  });

  it("reports malformed history without rewriting it or failing the lease", async () => {
    const file = join(dir, "lease-audit.jsonl");
    await writeFile(file, '{"partial":');
    await expect(readLeaseAuditHistory(file)).rejects.toThrow();
    await expect(renew()).resolves.toBeUndefined();
    expect(await readFile(file, "utf8")).toBe('{"partial":');
  });

  it("isolates a throwing JSONL path and a hanging artifact read from lease renewal", async () => {
    deps.store.getTaskDir = () => { throw new Error("unavailable"); };
    await expect(renew()).resolves.toBeUndefined();
    deps.store.getTaskDir = () => dir;
    deps.store.getTask = vi.fn(() => new Promise(() => {}));
    vi.useFakeTimers();
    const renewal = renew();
    await vi.advanceTimersByTimeAsync(2_000);
    vi.useRealTimers();
    await expect(renewal).resolves.toBeUndefined();
    expect((await events())[0].progress.status).toBe("unknown");
  });
});
