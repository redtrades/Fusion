# Named-script execution evidence

## Original Description

Implement approved A1 from issue268's deterministic evidence plan. Leave task-step projection (A2) out.

## What This Delivers

Operators can inspect actual bounded script output and separate results for each foreach instance, without pretending a script performed an AI review.

## Before → After Transformation

Before: successful command output is replaced by a generic sentence; ordinary and foreach scripts have no node progress records. After: real bounded streams and exit diagnostics reach ordinary node results, foreach results use distinct instance identities, and completion logs carry those outputs on a best-effort basis.

## Symptom Verification

Original symptom: missing real script assertion marker and no ordinary/foreach node records.
Exact reproduction: workflow-script-evidence.test.ts calls the real native configured-command path with harmless printf, then runs the graph executor for top-level and two-instance scripts.
Assertion it is gone: actual stdout/stderr and exit evidence retained, bounded streams, distinct result IDs, no reviewKind, failed/advisory/cancelled/skipped semantics retained, optional groups produce no child duplicates. Task.steps remains pending: A2 is excluded.
