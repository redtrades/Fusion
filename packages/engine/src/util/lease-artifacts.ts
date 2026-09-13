import { runGhJsonAsync } from "@fusion/core";

export type LeaseArtifact = {
  pr: string;
  head: string | null;
  ci: string | null;
  review: string | null;
  observed_at: string;
};

/**
 * FNXC:LeaseAudit 2026-09-13-21:27:
 * Read directly through Fusion's existing async gh adapter: dashboard badge polling does not
 * persist unchanged samples and cannot establish zero deltas at the 30-second renewal cadence.
 * Only the PR identity comes from the task; progress fields must come from this read-only query.
 */
export async function readLeaseArtifact(prUrl: string): Promise<LeaseArtifact> {
  const url = new URL(prUrl);
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !match) throw new Error("Unsupported PR URL");
  const result = await runGhJsonAsync<{
    headRefOid?: string;
    reviewDecision?: string | null;
    statusCheckRollup?: Array<{ __typename?: string; name?: string; context?: string;
      status?: string; conclusion?: string; state?: string }> | null;
  }>(["pr", "view", match[3], "--repo", `${match[1]}/${match[2]}`,
    "--json", "headRefOid,statusCheckRollup,reviewDecision"], { timeoutMs: 1_500 });
  const checks = result.statusCheckRollup;
  const ci = Array.isArray(checks) ? JSON.stringify(checks.map((check) => ({
    type: check.__typename ?? null, name: check.name ?? check.context ?? null,
    status: check.status ?? check.state ?? null, conclusion: check.conclusion ?? null,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) : null;
  return { pr: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
    head: result.headRefOid || null, ci,
    review: typeof result.reviewDecision === "string" ? result.reviewDecision || "none" : null,
    observed_at: new Date().toISOString() };
}
