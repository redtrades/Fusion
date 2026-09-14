# Approved branch correction

Parent e582139d5c352ad8fd52b7fcb27d658f1be09bc4 remains frozen. Root approved narrow follow-up after accepted native-IR diamond reproduced success without projection and failure with A2. Evidence mode: fallback committed source and native tests.

Use existing native chooseNextEdge exit semantics. Remove all-template cardinality as completion authority; retain actual success, scriptSucceeded, absence of notRunReason, abort and fenced native completion ACK for every traversed script. No new structural-exit restriction or eligibility narrowing.

RED accepted-IR diamond through native runForeach, then minimal removal, selected-branch failure/unverified/skipped/cancel tests, existing linear/ownership tests and engine build. No live operations/public push. Exact revision needs new independent review; prior e582 PASS missed this defect.
