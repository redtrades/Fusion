# Released native principal handoff

Base: 9d552ef154389a902cbef5dd6baed7635687a0f6. Worktree: /Users/man/worktrees/Fusion/300-release-principal-handoff. Evidence: current source, isolated real PostgreSQL and actual native interpreter/principal functions. No inference, live database, public push or actor endpoint.

## Delivered behavior

The actual selected continuation ID now reaches beforeNodeExecution even when the released successor lacks principalAgentId. Principal fields retain their prior conditional behavior. Matching released scope uses the dedicated native store handoff; unrelated later continuation IDs use ordinary admission. The dedicated native transaction classifies the referenced real work-item row using the exact deterministic release identity, not a run-id prefix. Related retired rows refuse; only a positively unrelated native row returns not-applicable and permits ordinary replacement. This also refuses stale A after pointer A advances to B.

TaskStore.replaceWorkflowOverlayReleasedPrincipal(input,fence) validates native current checkout, exact active predecessor, graph/custom IR, routed principal input and top-level or direct loop instance. It atomically replaces the predecessor and advances two fields in existing currentTerminal.release: currentAdmittedWorkItemId/currentAdmittedNodeInstanceId. No schema or generic lineage store. Physical work-item run IDs are release-specific; stableWorkflowRunId is the real graph. Earlier terminal principal rows are retained, not recreated.

TaskStore.readWorkflowOverlayReleasedAdmission(taskId,{admission,graphRunId,workItemId,nodeInstanceId}) returns valid:true with terminal and exact running workItem only while that pointer, current lease and selected IR remain authoritative. Reset cancellation or ordinary replacement invalidates it. This is a trusted native ownership check, not human/orchestrator authorization. Original terminal release replay continues to refuse a retired successor.

The overlay consumes actual context workflow:work-item-id, or the native carried workflow:resumed-work-item-id for unclassified gates, reads that exact work item and supplies its actual nodeInstanceId to the validator. It must separately match the active phase/loop identity and durable terminal failure before retry selection. Merely reading metadata is insufficient.

## Verification

31 composed real PG tests pass: 13 existing A4, 8 existing release, 2 outer failure/routing, 8 new principal handoff tests. New tests exercise production continuation-context construction for successor without principal; actual admitWorkflowPrincipalBeforeNode; actual WorkflowGraphExecutor producing build-loop#1:builder and build-loop#2:builder; stale pointer refusal; wrong ownership/IR/loop ancestry; Reset before/after transfer; atomic rollback; lost projection recovery without another work-item/audit; completed release followed by unrelated checkout with normal admission.

Logs: /tmp/300-principal-composed-pg.log; isolated runner /tmp/fusion300-principal-handoff-pg-run.mjs. Own ephemeral PG stopped. Original missing API red test: /tmp/fusion300-principal-handoff-red.log. Previous overlay/native principal defect evidence remains /tmp/300-overlay-principal-failing-source.test.ts and /tmp/300-overlay-principal-pg.log.

## Negative evidence and limits

Initial fixture used the pre-persistence IR object; PostgreSQL jsonb ordering changed the existing native serialization-based pin. Corrected the fixture to consume reloaded current definition, exactly as native production does. Raw interpreter result has outcome, not TaskRunner disposition. Initial projection count included the native failure log's task projection; retry assertion now isolates the recovery call and still proves no additional audit/work item.

No full TaskExecutor wrapper run or model execution was performed. Tests use its production context helper plus real principal admission and loop interpreter. Native pointer validation does not prove the overlay consumes accepted checkpoint receipts or preserves its correction budget on released re-entry; that pending integration remains explicit. No actor authorization endpoint. Core build/typecheck, engine typecheck, scoped ESLint, git diff --check and four existing principal-routing unit tests pass. Local engine dependency links point at this worktree core build, avoiding shared integration writes. Review exact revision before integration.

Final verification detail: the 31-test composed run preceded the last request-task-ID ownership tightening; all 8 handoff PG tests were rerun after that change and pass (/tmp/300-principal-final-pg.log). Final core build, engine typecheck and lint are clean. No production source changed after those checks. Untracked dependency links/build artifacts are excluded from the commit.

## Coordinator review and integration

Exact source973beea9813c8a3a85aeaad97cf0f71db3c64950 received an independent supplied-source PASS from actual nous/upstage/solar-pro4:free through Hermes. Native usage: 2calls,20,365total tokens,estimated USD0,no fallback/auxiliary compaction. Raw reviewer text is preserved adjacent; despite JSON-like framing it is not valid JSON, and no machine parse is claimed. It explicitly reports PASS with no findings. Its prose is review judgment, not independent runtime execution.

Integrated locally as0e2ee6dc2 after reviewed Board899fd975b and evidence6c900e3c2. Root reran final composition: 21core plus10engine realPG tests all passed (31total), including all8 handoff tests after final ownership tightening. /tmp/fusion300-principal-coordinator-pg.log; isolated runner /tmp/fusion300-principal-coordinator-pg-run.mjs. The database stopped cleanly. Intentional refusal/projection-failure tests emit expected error logs. Core production build passed (/tmp/fusion300-principal-core-build.log). No public push, production deployment, actor authorization or full overlay resume acceptance.

Coordinator engine production build also passed on0e2ee6dc2 (/tmp/fusion300-principal-engine-build.log, exit0). Human-visible progress receipt: https://github.com/redtrades/agents/issues/300#issuecomment-5659216281.
