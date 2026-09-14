---
"@runfusion/fusion": patch
---

summary: Forward Hermes runtime cancellation and optionally capture exact-session usage snapshots.
category: fix
dev: Session snapshots are cumulative reported metadata, not hard-budget enforcement or provider attestation. Existing chat and fallback behavior is unchanged.
