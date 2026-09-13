import { readLeaseAuditHistory } from "../packages/engine/src/util/lease-audit.js";

const [file, claimId] = process.argv.slice(2);
if (!file) throw new Error("Usage: pnpm exec tsx scripts/lease-audit.ts <lease-audit.jsonl> [claim_id]");
const history = await readLeaseAuditHistory(file, claimId);
const claims = new Map<string, typeof history>();
for (const event of history) {
  const events = claims.get(event.claim_id) ?? [];
  events.push(event);
  claims.set(event.claim_id, events);
}
console.log(JSON.stringify({ observation_only: true, claims: [...claims].map(([claim_id, renewals]) => ({
  claim_id, status: renewals.at(-1)!.progress.status, renewals,
})) }, null, 2));
