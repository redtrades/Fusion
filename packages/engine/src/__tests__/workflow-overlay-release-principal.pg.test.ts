import { createWorkflowContinuationContext } from "../executor/execute-workflow-graph.js";
import { WorkflowGraphExecutor } from "../workflows/workflow-graph-executor.js";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createSharedPgTaskStoreTestHarness, pgDescribe } from '../../../core/src/__test-utils__/pg-test-harness.js';
import { admitWorkflowPrincipalBeforeNode } from '../executor/workflow-principal-before-node.js';

pgDescribe('released overlay identity through real native principal admission', () => {
  const h = createSharedPgTaskStoreTestHarness({ prefix: 'overlay_release_principal', projectId: 'proj-release-principal' });
  beforeAll(h.beforeAll); beforeEach(h.beforeEach); afterEach(h.afterEach); afterAll(h.afterAll);
  async function fixture(loop = false) {
    const store = h.store();
    const node = { id: 'builder', kind: 'prompt', column: 'in-progress', config: { seam: 'execute' } };
    const ir = { version: 'v2', name: 'release-principal', columns: [{ id: 'in-progress', name: 'WIP', traits: [{ trait: 'wip' }] }],
      nodes: [{ id: 'start', kind: 'start', column: 'in-progress' }, node, { id: 'end', kind: 'end', column: 'in-progress' }],
      edges: [{ from: 'start', to: 'builder', condition: 'success' }, { from: 'builder', to: 'end', condition: 'success' }] } as any;
    if (loop) {
      ir.nodes[1] = { id: 'build-loop', kind: 'loop', column: 'in-progress', config: { maxIterations: 2, maxReworkCycles: 1, timeoutMs: 10000,
        exitWhen: { type: 'output-matches', nodeId: 'builder', pattern: '^passed$' },
        template: { nodes: [node, { id: 'iteration-end', kind: 'gate', column: 'in-progress', config: {} }], edges: [{ from: 'builder', to: 'iteration-end', condition: 'success' }] } } };
      ir.edges = [{ from: 'start', to: 'build-loop', condition: 'success' }, { from: 'build-loop', to: 'end', condition: 'success' }];
    }
    const definition = await store.createWorkflowDefinition({ name: 'release principal fixture', ir });
    const task = await store.createTask({ description: 'release principal fixture', workflowId: definition.id });
    const admission = { runId: 'checkout', leaseEpoch: 1, agentId: 'agent', nodeId: 'host' };
    const claim = () => store.updateTask(task.id, { checkedOutBy: admission.agentId, checkoutNodeId: admission.nodeId, checkoutRunId: admission.runId, checkoutLeaseEpoch: admission.leaseEpoch });
    await claim();
    const terminal = await store.applyWorkflowOverlayTerminalFenced(task.id, { admission, expectedColumn: task.column, targetColumn: task.column, expectedPhaseCount: 0, operationId: 'terminal',
      nextState: { runId: 'graph', claimId: 'claim', occurrence: 0, phaseCount: 1, previousEnvelope: null, reviewedHeadOid: null,
        receipts: [{ terminalBlock: { reason: 'missing-input', blockingNodeId: loop ? 'build-loop' : 'builder', resumeActor: 'orchestrator' } }] } });
    expect(terminal.applied).toBe(true);
    await claim();
    const held = await store.readWorkflowOverlayCurrentTerminal(task.id); if (!held.current) throw new Error('missing hold');
    const request = { expectedGraphRunId: 'graph', expectedTerminalOperationId: 'terminal', releaseOperationId: 'release', admission, expectedWorkflowIrHash: held.terminal.workflowIrHash };
    const released = await store.releaseWorkflowOverlayTerminalFenced(task.id, request); if (!released.applied) throw new Error('release failed');
    const agent = { id: 'agent', name: 'fixture', roles: ['executor'], role: 'executor', state: 'idle', metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const deps = { store, options: { agentStore: { listAgents: async () => [agent], workflowProjectId: 'proj-release-principal' } },
      workflowAgentCapacity: { activeSessions: () => 0, acquire: async () => ({ status: 'acquired' }), release: () => {} },
      activeWorkflowAuthorities: new Map(), activeWorkflowPrincipals: new Map(), workflowGateActivityPrincipals: new Map(),
      workflowCapacityAttemptIds: new Set(), directWorkflowPrincipalWorkItemIds: new Set(), directWorkflowPrincipalHeldWorkItemIds: new Set(),
      columnAgentIr: (await store.getWorkflowDefinition(definition.id))!.ir, resolveBindingForNode: () => undefined, resolvedRunId: 'graph', settings: { maxConcurrent: 12 } } as any;
    const context: Record<string, unknown> = { ...createWorkflowContinuationContext(released.successor), 'workflow:node-instance-id': 'builder' };
    return { store, task, admission, claim, held, request, released, node, deps, context, definition };
  }
  it('retains a native-validatable release identity at plugin entry', async () => {
    const { store, task, admission, request, released, node, deps, context } = await fixture();
    expect(released.successor.principalAgentId).toBeNull();
    expect(await admitWorkflowPrincipalBeforeNode(deps, node as any, await store.getTask(task.id), context)).toBeUndefined();
    const current = await store.getWorkflowWorkItem(context['workflow:work-item-id'] as string);
    expect(current).toMatchObject({ state: 'running', nodeId: 'builder', principalAgentId: 'agent' });
    // Actual plugin entry now needs native validation; metadata alone is not authority.
    expect(await store.releaseWorkflowOverlayTerminalFenced(task.id, request)).toMatchObject({ applied: false, reason: 'terminal-superseded' });
    expect(await (store as any).readWorkflowOverlayReleasedAdmission(task.id, { admission, graphRunId: 'graph', workItemId: current!.id, nodeInstanceId: 'builder' })).toMatchObject({ valid: true });
  });
  it('does not permanently divert unrelated checkout after released work completes, but refuses cancelled matching context', async () => {
    const f = await fixture();
    await admitWorkflowPrincipalBeforeNode(f.deps, f.node as any, await f.store.getTask(f.task.id), f.context);
    const currentId = f.context['workflow:work-item-id'] as string;
    await f.store.transitionWorkflowWorkItem(currentId, 'succeeded');
    const newer = { ...f.admission, runId: 'unrelated-checkout', leaseEpoch: 2 };
    await f.store.updateTask(f.task.id, { checkoutRunId: newer.runId, checkoutLeaseEpoch: newer.leaseEpoch });
    const independent = await f.store.replaceActiveTaskWorkflowContinuation({ taskId: f.task.id, kind: 'task', nodeId: 'builder', runId: 'independent', state: 'running' });
    const normal: Record<string, unknown> = { 'workflow:resumed-work-item-id': independent.id, 'workflow:node-instance-id': 'builder' };
    expect(await admitWorkflowPrincipalBeforeNode({ ...f.deps, resolvedRunId: 'independent-graph' }, f.node as any, await f.store.getTask(f.task.id), normal)).toBeUndefined();
    const row = await f.store.getWorkflowWorkItem(normal['workflow:work-item-id'] as string);
    expect(row?.runId).toBe('independent-graph:builder');
    expect(await f.store.readWorkflowOverlayReleasedAdmission(f.task.id, { admission: newer, graphRunId: 'independent-graph', workItemId: row!.id, nodeInstanceId: 'builder' })).toMatchObject({ valid: false });
    const stale = { 'workflow:resumed-work-item-id': currentId, 'workflow:node-instance-id': 'builder' };
    expect(await admitWorkflowPrincipalBeforeNode(f.deps, f.node as any, await f.store.getTask(f.task.id), stale)).toMatchObject({ outcome: 'failure' });
    expect((await f.store.getWorkflowWorkItem(row!.id))?.state).toBe('running');
  });

  it.each([false, true])('Reset invalidates released principal scope after handoff=%s', async transferred => {
    const f = await fixture();
    if (transferred) await admitWorkflowPrincipalBeforeNode(f.deps, f.node as any, await f.store.getTask(f.task.id), f.context);
    const oldId = f.context['workflow:work-item-id'] as string | undefined;
    await f.store.resetTaskPublication(f.task.id, f.task.column); await f.claim();
    const result = await admitWorkflowPrincipalBeforeNode(f.deps, f.node as any, await f.store.getTask(f.task.id), f.context);
    expect(result).toMatchObject({ outcome: 'failure' });
    if (oldId) expect(await f.store.readWorkflowOverlayReleasedAdmission(f.task.id, { admission: f.admission, graphRunId: 'graph', workItemId: oldId, nodeInstanceId: 'builder' })).toMatchObject({ valid: false });
    expect((await f.store.listWorkflowWorkItemsForTask(f.task.id)).filter(item => ['runnable', 'running', 'held', 'retrying'].includes(item.state))).toEqual([]);
  });

  it('rolls back replacement if publishing its release pointer fails', async () => {
    const f = await fixture();
    await h.adminSql().unsafe(`CREATE FUNCTION project.reject_principal_pointer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_metadata #>> '{procedureEngineLive,currentTerminal,release,currentAdmittedWorkItemId}' IS NOT NULL THEN RAISE EXCEPTION 'pointer fixture rejection'; END IF; RETURN NEW; END $$`);
    await h.adminSql().unsafe(`CREATE TRIGGER reject_principal_pointer BEFORE UPDATE ON project.tasks FOR EACH ROW EXECUTE FUNCTION project.reject_principal_pointer()`);
    try { expect(await admitWorkflowPrincipalBeforeNode(f.deps, f.node as any, await f.store.getTask(f.task.id), f.context)).toMatchObject({ outcome: 'failure' }); }
    finally { await h.adminSql().unsafe('DROP TRIGGER reject_principal_pointer ON project.tasks'); await h.adminSql().unsafe('DROP FUNCTION project.reject_principal_pointer()'); }
    expect((await f.store.getWorkflowWorkItem(f.released.successor.id))?.state).toBe('runnable');
    expect((await f.store.listWorkflowWorkItemsForTask(f.task.id)).filter(item => item.runId.startsWith('overlay-principal:'))).toEqual([]);
  });

  it('uses actual interpreter loop materialization and advances only the current principal pointer', async () => {
    const f = await fixture(true);
    const seen: string[] = [];
    const currentIds: string[] = [];
    const executor = new WorkflowGraphExecutor({
      initialContext: createWorkflowContinuationContext(f.released.successor),
      beforeNodeExecution: async (node, task, context) => admitWorkflowPrincipalBeforeNode(f.deps, node, task, context),
      handlers: { prompt: async (node, env) => {
        const context = env.context;
        const instance = context['workflow:node-instance-id'] as string;
        seen.push(instance); currentIds.push(context['workflow:work-item-id'] as string);
        expect(await f.store.readWorkflowOverlayReleasedAdmission(f.task.id, { admission: f.admission, graphRunId: 'graph', workItemId: currentIds.at(-1)!, nodeInstanceId: instance })).toMatchObject({ valid: true });
        if (seen.length === 2) {
          const stale = { 'workflow:resumed-work-item-id': currentIds[0], 'workflow:node-instance-id': seen[0], 'loop:active': { loopNodeId: 'build-loop', iteration: 1 } };
          expect(await admitWorkflowPrincipalBeforeNode(f.deps, node as any, await f.store.getTask(f.task.id), stale)).toMatchObject({ outcome: 'failure' });
          expect((await f.store.getWorkflowWorkItem(currentIds[1]))?.state).toBe('running');
        }
        return { outcome: 'success', value: seen.length === 1 ? 'failed' : 'passed' };
      }, gate: async () => ({ outcome: 'success' }) },
    });
    const result = await executor.run(await f.store.getTask(f.task.id), {}, f.deps.columnAgentIr, 'build-loop');
    expect(result.outcome).toBe('success');
    expect(seen).toEqual(['build-loop#1:builder', 'build-loop#2:builder']);
    expect((await f.store.getWorkflowWorkItem(currentIds[0]))?.state).toBe('succeeded');
    expect(await f.store.readWorkflowOverlayReleasedAdmission(f.task.id, { admission: f.admission, graphRunId: 'graph', workItemId: currentIds[0], nodeInstanceId: seen[0] })).toMatchObject({ valid: false });
  });

  it('refuses wrong admission, edited IR, and invented loop ancestry before replacing the active successor', async () => {
    const f = await fixture(true);
    const input = { taskId: f.task.id, kind: 'task' as const, nodeId: 'builder', nodeInstanceId: 'build-loop#1:builder', runId: 'graph:build-loop#1:builder', state: 'running' as const,
      principalAgentId: 'agent', workflowRole: 'executor' as const, authorityKind: 'role-pool' as const, stableWorkflowRunId: 'graph', irHash: f.held.terminal.workflowIrHash };
    const fence = { admission: f.admission, graphRunId: 'graph', workflowIrHash: f.held.terminal.workflowIrHash, resumedWorkItemId: f.released.successor.id,
      loop: { loopNodeId: 'build-loop', iteration: 1 } };
    for (const admission of [{ ...f.admission, agentId: 'wrong' }, { ...f.admission, nodeId: 'wrong' }, { ...f.admission, leaseEpoch: 2 }]) {
      expect(await f.store.replaceWorkflowOverlayReleasedPrincipal(input, { ...fence, admission })).toMatchObject({ applied: false, reason: 'ownership-mismatch' });
    }
    for (const loop of [{ loopNodeId: 'missing-loop', iteration: 1 }, { loopNodeId: 'build-loop', iteration: 3 }]) {
      expect(await f.store.replaceWorkflowOverlayReleasedPrincipal(input, { ...fence, loop })).toMatchObject({ applied: false, reason: 'workflow-mismatch' });
    }
    await f.store.updateWorkflowDefinition(f.definition.id, { ir: { ...f.deps.columnAgentIr, name: 'changed' } });
    expect(await f.store.replaceWorkflowOverlayReleasedPrincipal(input, fence)).toMatchObject({ applied: false, reason: 'workflow-mismatch' });
    expect((await f.store.getWorkflowWorkItem(f.released.successor.id))?.state).toBe('runnable');
  });

  it('recovers a lost handoff projection from the actual admitted continuation without another work item or audit', async () => {
    const f = await fixture();
    const projection = vi.spyOn(f.store, 'writeTaskJsonFile').mockRejectedValueOnce(new Error('projection fixture failure'));
    expect(await admitWorkflowPrincipalBeforeNode(f.deps, f.node as any, await f.store.getTask(f.task.id), f.context)).toMatchObject({ outcome: 'failure' });
    projection.mockClear();
    const active = (await f.store.listWorkflowWorkItemsForTask(f.task.id)).filter(item => item.state === 'running');
    expect(active).toHaveLength(1);
    const before = await h.adminSql()`SELECT count(*)::int AS n FROM project.run_audit_events`;
    const resumed = { ...createWorkflowContinuationContext(active[0]), 'workflow:node-instance-id': 'builder' };
    expect(await admitWorkflowPrincipalBeforeNode(f.deps, f.node as any, await f.store.getTask(f.task.id), resumed)).toBeUndefined();
    const after = await h.adminSql()`SELECT count(*)::int AS n FROM project.run_audit_events`;
    expect(after[0].n).toBe(before[0].n);
    expect(projection).toHaveBeenCalledTimes(1); projection.mockRestore();
    expect(await f.store.readWorkflowOverlayReleasedAdmission(f.task.id, { admission: f.admission, graphRunId: 'graph', workItemId: active[0].id, nodeInstanceId: 'builder' })).toMatchObject({ valid: true });
  });

});
