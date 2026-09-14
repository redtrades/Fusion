# A2 RED-only investigation

Approved: root's bounded A2 tests, based frozen A1 0cbfe89281ed41a1147466a03dc4deefb95f61f9. No production edit. Evidence mode fallback source and actual isolated PostgreSQL/native TaskStore.

Seams: WorkflowGraphExecutor.run script-only shared foreach observes native task statuses at command entry and completion; native startStep/updateStep simulate the proposed production callback with a deferred command and actual Reset publication or checkout release while in-flight. These latter tests measure the mutation seam, not an implemented A2 callback. Parent rejected assuming same-process checkout prevents stale publication; tests must establish it.

Expected RED: native graph does not project task steps; existing native graph-source updateStep must not mark a new owner's replacement step complete. Green controls: native accepted/rejected start, failure/skipped/advisory/cancel outcomes, existing review/worktree ownership tests run separately against unchanged production.
