import { WorkflowGraphExecutor } from "../workflows/workflow-graph-executor.js";
import * as persistence from "../../../core/src/task-store/async/async-persistence.js";
import { TaskStore } from "../../../core/src/store.js";
import { runWorkflowMergeAttemptNode } from "../workflows/workflow-merge-nodes.js";
import { TaskExecutor } from "../executor.js";
import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createSharedPgTaskStoreTestHarness, pgDescribe } from '../../../core/src/__test-utils__/pg-test-harness.js';
import { ProjectEngine } from '../project-engine.js';
import { processPullRequestMergeTask } from '../../../cli/src/commands/task-lifecycle.js';
import { getTaskMergeBlocker } from '@fusion/core';
import { GitHubSourceIssueCloseService } from '../../../dashboard/src/github-source-issue-close.js';
const remote = vi.hoisted(() => ({ close: vi.fn(), getIssue: vi.fn(), head: '1'.repeat(40), branch: 'fixture-303' }));
vi.mock('../../../dashboard/src/github.js', () => ({ GitHubClient: class {
        setIssueState = remote.close;
        getIssue = remote.getIssue;
    } }));
vi.mock('../../../dashboard/src/github-auth.js', () => ({ resolveGithubTrackingAuth: () => ({ ok: true, auth: { mode: 'gh-cli' } }) }));
vi.mock('@fusion/core', async (importOriginal) => ({ ...await importOriginal<typeof import('@fusion/core')>(), getCurrentRepo: () => ({ owner: 'fixture', repo: 'repo' }), getPushRepo: () => ({ owner: 'fixture', repo: 'repo' }) }));
// Only git process I/O is intercepted. The PG store and all lifecycle writes are real.
vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    function output(args: string[], cwd: string) {
        const command = args.join(' ');
        if (command === 'worktree list --porcelain')
            return `worktree ${cwd}\nHEAD ${remote.head}\nbranch refs/heads/main\n\nworktree ${cwd}/existing-task-worktree\nHEAD ${remote.head}\nbranch refs/heads/${remote.branch}\n`;
        if (command.includes('rev-parse --show-toplevel'))
            return cwd;
        if (command.includes('symbolic-ref -q HEAD'))
            return `refs/heads/${remote.branch}\n`;
        if (command.includes('rev-parse HEAD'))
            return remote.head + '\n';
        if (command.includes('rev-parse --verify refs/heads/'))
            return remote.head + '\n';
        if (command.includes('ls-remote'))
            return remote.head + '\trefs/heads/fixture-303\n';
        if (command === 'remote')
            return 'origin\n';
        if (command.includes('config --get branch.'))
            return 'origin\n';
        return '';
    }
    return { ...actual, exec: (command: string, opts: any, cb: any) => { if (!command.startsWith('git '))
            return (actual.exec as any)(command, opts, cb); cb(null, '', ''); return { kill: () => true }; }, execFile: (file: string, args: string[], opts: any, cb: any) => {
            if (file !== 'git')
                return (actual.execFile as any)(file, args, opts, cb);
            cb(null, output(args, opts?.cwd ?? ''), '');
            return { kill: () => true };
        } };
});
pgDescribe('native task merge requester route', () => {
    const h = createSharedPgTaskStoreTestHarness({ prefix: 'task_merge_route', projectId: 'proj-task-merge-route', poolMax: 4 });
    beforeAll(h.beforeAll);
    beforeEach(h.beforeEach);
    afterEach(h.afterEach);
    afterAll(h.afterAll);
    async function fixture(protectedRequest = true) {
        const store = h.store();
        await store.updateSettings({ autoMerge: true, githubNativeAutoMerge: true, githubCloseSourceIssueOnDone: true, baseBranch: 'main', globalPause: false, enginePaused: false, maxConcurrent: 4 });
        const workflow = await store.createWorkflowDefinition({ name: 'native review merge completion', ir: { version: 'v2', name: 'native review merge completion', columns: [{ id: 'inbox', name: 'Inbox', traits: [{ trait: 'intake' }] }, { id: 'in-progress', name: 'WIP', traits: [{ trait: 'wip' }] }, { id: 'in-review', name: 'Review', traits: [{ trait: 'merge' }] }, { id: 'done', name: 'Done', traits: [{ trait: 'complete' }] }], nodes: [{ id: 'start', kind: 'start', column: 'inbox' }, { id: 'work', kind: 'agent', column: 'in-progress' }, { id: 'review', kind: 'prompt', column: 'in-review' }, { id: 'merge', kind: 'merge-attempt', column: 'in-review', config:{requireProtectedMerge:protectedRequest} }, { id: 'end', kind: 'end', column: 'done' }], edges: [{ from: 'start', to: 'work' }, { from: 'work', to: 'review' }, { from: 'review', to: 'merge', condition: 'success' }, { from: 'merge', to: 'end', condition: 'success' }] } } as never);
        const task = await store.createTask({ title: 'existing PR completion fixture', description: 'no model execution', column: 'in-review', workflowId: workflow.id, autoMerge: true, proposalClaimId: 'fixture:303', sourceIssue: { provider: 'github', repository: 'fixture/repo', externalIssueId: '303', issueNumber: 303 } });
        // Preexisting implementation is fixture input, not claimed execution/review evidence.
        for (let i = 0; i < (await store.getTask(task.id)).steps.length; i++)
            await store.updateStep(task.id, i, 'done');
        const claim = {agentId:'fixture-agent',nodeId:'fixture-node',runId:'checkout-A',leaseEpoch:1,renewedAt:new Date().toISOString()};
        expect(await store.tryClaimCheckout(task.id,claim,{})).toMatchObject({ok:true});
        const options = protectedRequest ? {protectedMerge:{expectedHeadOid:'1'.repeat(40),admission:{runId:claim.runId,leaseEpoch:claim.leaseEpoch,agentId:claim.agentId,nodeId:claim.nodeId},workflowId:workflow.id,expectedColumn:'in-review'}} : {};
        const worktree = join(h.rootDir(), 'existing-task-worktree');
        await mkdir(worktree, { recursive: true });
        await store.updateTask(task.id, { branch: 'fixture-303', branchWriteOrigin: 'operator', worktree });
        const pr = { number: 9, url: 'https://github.com/fixture/repo/pull/9', status: 'open' as const, title: 'existing', headBranch: 'fixture-303', baseBranch: 'main', commentCount: 0 };
        await store.updatePrInfo(task.id, pr);
        const entity = await store.ensurePrEntityForSource({ sourceType: 'task', sourceId: task.id, repo: 'fixture/repo', headBranch: 'fixture-303', baseBranch: 'main', headOid: '1'.repeat(40), state: 'open', prNumber: 9, prUrl: pr.url } as never);
        let state: 'open' | 'merged' = 'open';
        remote.head = '1'.repeat(40);
        remote.close.mockReset();
        remote.getIssue.mockReset();
        remote.getIssue.mockResolvedValue({ state: 'open' });
        remote.close.mockImplementation(async () => { remote.getIssue.mockResolvedValue({ state: 'closed' }); });
        const github = { findPrForBranch: vi.fn(), createPr: vi.fn(), getPrMergeStatus: vi.fn(async () => ({ prInfo: { ...pr, status: state }, mergeReady: true, reviewDecision: 'APPROVED', headOid: remote.head })), mergePr: vi.fn(async () => ({ ...pr, status: state })) };
        const service = new GitHubSourceIssueCloseService(store);
        service.start();
        const engine = new ProjectEngine({ projectId: task.id + '-' + h.rootDir(), workingDirectory: h.rootDir(), isolationMode: 'in-process', maxConcurrent: 4, maxWorktrees: 4 }, {} as never, { skipNotifier: true, externalTaskStore: store, getTaskMergeBlocker, getMergeStrategy: () => 'pull-request', processPullRequestMerge: (store, cwd, id, signal, protectedMerge) => processPullRequestMergeTask(store, cwd, id, github as never, (task, options) => { const blocker = getTaskMergeBlocker(task, options); console.log('ACTUAL_BLOCKER', JSON.stringify({ blocker, column: task.column, paused: task.paused, status: task.status, steps: task.steps })); return blocker; }, signal, protectedMerge) });
        // Component fixture: real ProjectEngine constructor/request/queue; no scheduler or agents started.
        vi.spyOn((engine as any).runtime, 'getTaskStore').mockReturnValue(store);
        (engine as any).started = true;
        (engine as any).wireAutoMerge(store, h.rootDir());
        (engine as any).wireTaskPauseMergeInterruption(store);
        return { store, task, entity, github, engine, options, claim, setMerged: () => { state = 'merged'; }, stop: async () => { service.stop(); (engine as any).shuttingDown = true; for (const [event, key] of [['task:moved', 'taskMovedHandler'], ['task:updated', 'taskUpdatedHandler'], ['task:deleted', 'taskDeletedHandler']])
                store.off(event, (engine as any)[key]); (engine as any).unregisterMergeAdmissionProvider?.(); for (const timer of (engine as any).prMergeRetryTimers.values())
                clearTimeout(timer); } };
    }
    it.each([false,true])('waits for authoritative merge and closes once (protected=%s)', async protectedRequest => {
        const f = await fixture(protectedRequest);
        try {
            const requested = await f.engine.requestInterpreterMerge(f.task.id, f.options);
            expect(requested.merged).toBe(false);
            expect((await f.store.getTask(f.task.id)).column).toBe('in-review');
            expect(remote.close).not.toHaveBeenCalled();
            expect(f.github.mergePr).toHaveBeenCalledTimes(1);
            f.setMerged();
            const confirmed = await f.engine.requestInterpreterMerge(f.task.id, f.options);
            console.log('TASK_MERGE_ROUTE', JSON.stringify({ requested: requested.merged, confirmed: confirmed.merged, column: (await f.store.getTask(f.task.id)).column, checkoutRunId:(await f.store.getTask(f.task.id)).checkoutRunId,checkoutLeaseEpoch:(await f.store.getTask(f.task.id)).checkoutLeaseEpoch,checkedOutBy:(await f.store.getTask(f.task.id)).checkedOutBy, mergeCalls: f.github.mergePr.mock.calls.length }));
            expect(confirmed.merged).toBe(true);
            expect((await f.store.getTask(f.task.id)).column).toBe('done');
            await expect.poll(() => remote.close.mock.calls.length).toBe(1);
            const replay = await f.engine.requestInterpreterMerge(f.task.id, f.options);
            expect(replay.merged).toBe(false);
            expect(remote.close).toHaveBeenCalledTimes(1);
            expect(f.github.createPr).not.toHaveBeenCalled();
        }
        finally {
            await f.stop();
        }
    });
    it.each([false, true])('RED: retains reviewed A after refresh B (native auto=%s)', async (nativeAuto) => {
        const f = await fixture();
        try {
            await f.store.updateSettings({ githubNativeAutoMerge: nativeAuto });
            remote.head = '2'.repeat(40);
            // There is no expectedHeadOid field on the public requester. The PR entity still records A.
            await expect(f.engine.requestInterpreterMerge(f.task.id, f.options)).rejects.toMatchObject({code:'stale-head'});
            console.log('HEAD_GAP', JSON.stringify({ reviewedHead: '1'.repeat(40), refreshedHead: remote.head, mergeArgs: f.github.mergePr.mock.calls }));
            expect(f.github.mergePr).not.toHaveBeenCalled();
        }
        finally {
            await f.stop();
        }
    });
    it.each(['reset', 'new-checkout'])('rejects stale request after %s during the remote status await', async (race) => {
        const f = await fixture();
        try {
            const claim = f.claim;
            const probe = f.github.getPrMergeStatus.getMockImplementation()!;
            f.github.getPrMergeStatus.mockImplementationOnce(async () => {
                if (race === 'reset')
                    await f.store.resetTaskPublication(f.task.id, 'in-review');
                else
                    expect(await f.store.tryClaimCheckout(f.task.id, { ...claim, runId: 'checkout-B', leaseEpoch: 2 }, { expectedCheckedOutBy: claim.agentId, expectedNodeId: claim.nodeId, expectedLeaseEpoch: 1 })).toMatchObject({ ok: true });
                return await probe();
            });
            const outcome = await f.engine.requestInterpreterMerge(f.task.id, f.options).catch(error => ({ error: error.message }));
            await (f.engine as any).mergeBodyInFlight?.catch(() => undefined);
            await new Promise(resolve => setImmediate(resolve));
            console.log('ADMISSION_RACE', JSON.stringify({ race, outcome: 'error' in outcome ? outcome.error : outcome.merged, mergeCalls: f.github.mergePr.mock.calls.length, checkout: (await f.store.getTask(f.task.id)).checkoutRunId, column: (await f.store.getTask(f.task.id)).column }));
            expect(f.github.mergePr).not.toHaveBeenCalled();
            expect((await f.store.getTask(f.task.id)).column).not.toBe('done');
            expect(remote.close).not.toHaveBeenCalled();
        }
        finally {
            await f.stop();
        }
    });
    it('honors explicit caller cancellation during the status await', async () => {
        const f = await fixture();
        try {
            const controller = new AbortController();
            const probe = f.github.getPrMergeStatus.getMockImplementation()!;
            f.github.getPrMergeStatus.mockImplementationOnce(async () => { controller.abort(); return await probe(); });
            await expect(f.engine.requestInterpreterMerge(f.task.id, { ...f.options, signal: controller.signal })).rejects.toThrow(/aborted/i);
            await (f.engine as any).mergeBodyInFlight?.catch(() => undefined);
            expect(f.github.mergePr).not.toHaveBeenCalled();
            expect(remote.close).not.toHaveBeenCalled();
        }
        finally {
            await f.stop();
        }
    });
    it.each(['head','admission','unprotected'])('refuses a conflicting queued request (%s)',async conflict=>{
      const f=await fixture();let release!:()=>void;let entered!:()=>void;
      const barrier=new Promise<void>(resolve=>release=resolve);const ready=new Promise<void>(resolve=>entered=resolve);
      try {
        const probe=f.github.getPrMergeStatus.getMockImplementation()!;
        f.github.getPrMergeStatus.mockImplementationOnce(async()=>{entered();await barrier;return await probe();});
        const first=f.engine.requestInterpreterMerge(f.task.id,f.options);await ready;
        const next=conflict==='unprotected'?{}:{protectedMerge:{...f.options.protectedMerge!,...(conflict==='head'?{expectedHeadOid:'2'.repeat(40)}:{admission:{...f.options.protectedMerge!.admission,leaseEpoch:2}})}};
        const second=f.engine.requestInterpreterMerge(f.task.id,next);
        release();await expect(second).rejects.toMatchObject({code:'merge-request-superseded'});await first;
        expect(f.github.mergePr).toHaveBeenCalledTimes(1);
      }finally{release?.();await f.stop();}
    });

    it.each(['missing','stale','matching'])('the actual native merge primitive refuses %s protected input',async inputKind=>{
      const f=await fixture();try {
        f.setMerged();const executor=new TaskExecutor(f.store,h.rootDir());executor.setMergeRequester(f.engine.requestInterpreterMerge.bind(f.engine));
        const primitives=(executor as any).createAuthoritativeWorkflowPrimitives(await f.store.getSettings());
        const ctx={run:{taskId:f.task.id,runId:'graph-run',workflowId:f.options.protectedMerge!.workflowId},node:{node:{id:'merge',kind:'merge-attempt',column:'in-review',config:{requireProtectedMerge:true}}}};
        const result=await primitives.requestMerge(ctx,await f.store.getTask(f.task.id),inputKind==='missing'?undefined:{expectedHeadOid:(inputKind==='stale'?'2':'1').repeat(40),admission:f.options.protectedMerge!.admission});
        if(inputKind==='matching'){expect(result).toMatchObject({outcome:'success',data:{status:'merged'}});expect((await f.store.getTask(f.task.id)).column).toBe('done');}
        else {expect(result).toMatchObject({outcome:'failure',value:inputKind==='missing'?'merge-authority-unavailable':'stale-head'});expect((await f.store.getTask(f.task.id)).column).toBe('in-review');expect(remote.close).not.toHaveBeenCalled();}
      }finally{await f.stop();}
    });

    it('does not downgrade an explicitly protected graph to legacy interpreter options',async()=>{
      const f=await fixture();try {
        await expect(f.engine.requestInterpreterMerge(f.task.id)).rejects.toMatchObject({code:'merge-authority-unavailable'});
        expect(f.github.mergePr).not.toHaveBeenCalled();
      }finally{await f.stop();}
    });

    it.each(['missing','matching','wrong-run'])('consumes the earlier gate context in actual native merge-attempt (%s)',async proofKind=>{
      const f=await fixture();try {
        f.setMerged();const executor=new TaskExecutor(f.store,h.rootDir());executor.setMergeRequester(f.engine.requestInterpreterMerge.bind(f.engine));
        const primitives=(executor as any).createAuthoritativeWorkflowPrimitives(await f.store.getSettings());
        const proof={expectedHeadOid:'1'.repeat(40),admission:f.options.protectedMerge!.admission,taskId:f.task.id,workflowId:f.options.protectedMerge!.workflowId,runId:proofKind==='wrong-run'?'retired-graph':'graph-run'};
        const ctx={run:{taskId:f.task.id,runId:'graph-run',workflowId:proof.workflowId},node:{node:{id:'merge',kind:'merge-attempt' as const,column:'in-review',config:{requireProtectedMerge:true}},context:proofKind==='missing'?{}:{'workflow:protected-merge':proof}}};
        const result=await runWorkflowMergeAttemptNode({primitives},ctx,await f.store.getTask(f.task.id));
        expect(result).toMatchObject(proofKind==='matching'?{outcome:'success',value:'merged'}:{outcome:'failure',value:proofKind==='missing'?'merge-authority-unavailable':'merge-request-superseded'});
        if(proofKind!=='matching')expect((await f.store.getTask(f.task.id)).column).toBe('in-review');
      }finally{await f.stop();}
    });
    it.each([false,true])('ordinary automatic enqueue cannot discard protected graph policy (after cancellation=%s)',async cancelFirst=>{
      const f=await fixture();try {
        if(cancelFirst){
          const controller=new AbortController();const probe=f.github.getPrMergeStatus.getMockImplementation()!;
          f.github.getPrMergeStatus.mockImplementationOnce(async()=>{controller.abort();return await probe();});
          await f.engine.requestInterpreterMerge(f.task.id,{...f.options,signal:controller.signal}).catch(()=>undefined);
          await (f.engine as any).mergeBodyInFlight?.catch(()=>undefined);
          await expect.poll(()=>(f.engine as any).mergeRunning).toBe(false);
        }
        await f.store.replaceActiveTaskWorkflowContinuation({taskId:f.task.id,runId:'graph-run',nodeId:'merge',kind:'task',state:'runnable'});
        expect(f.engine.enqueueMerge(f.task.id)).toBe(true);
        await expect.poll(()=>(f.engine as any).mergeRunning).toBe(false);
        expect(f.github.mergePr).not.toHaveBeenCalled();expect((await f.store.getTask(f.task.id)).column).toBe('in-review');
      }finally{await f.stop();}
    });

    it.each(['agentId','nodeId'])('refuses matching epoch with wrong %s',async key=>{
      const f=await fixture();try{
        const fence={...f.options.protectedMerge!,admission:{...f.options.protectedMerge!.admission,[key]:'other'}};
        await expect(f.engine.requestInterpreterMerge(f.task.id,{protectedMerge:fence})).rejects.toMatchObject({code:'merge-request-superseded'});
        expect(f.github.mergePr).not.toHaveBeenCalled();expect(remote.close).not.toHaveBeenCalled();
      }finally{await f.stop();}
    });
    it.each(['different','missing'])('refuses already merged provider %s head',async kind=>{
      const f=await fixture();try{
        f.setMerged();const probe=f.github.getPrMergeStatus.getMockImplementation()!;
        f.github.getPrMergeStatus.mockImplementation(async()=>({...await probe(),headOid:kind==='missing'?undefined:'2'.repeat(40)}));
        await expect(f.engine.requestInterpreterMerge(f.task.id,f.options)).rejects.toMatchObject({code:kind==='missing'?'merge-authority-unavailable':'stale-head'});
        expect((await f.store.getTask(f.task.id)).column).toBe('in-review');expect(remote.close).not.toHaveBeenCalled();
      }finally{await f.stop();}
    });
    it('coalesces the identical protected request without a second provider mutation',async()=>{
      const f=await fixture();let entered!:()=>void,release!:()=>void;
      const ready=new Promise<void>(r=>entered=r),barrier=new Promise<void>(r=>release=r);
      try{const probe=f.github.getPrMergeStatus.getMockImplementation()!;
        f.github.getPrMergeStatus.mockImplementationOnce(async()=>{entered();await barrier;return probe();});
        const first=f.engine.requestInterpreterMerge(f.task.id,f.options);await ready;
        const second=f.engine.requestInterpreterMerge(f.task.id,f.options);
        await expect.poll(()=>(f.engine as any).manualMergeResolvers.get(f.task.id)?.length).toBe(2);
        release();expect((await Promise.all([first,second])).map(r=>r.merged)).toEqual([false,false]);
        expect(f.github.mergePr).toHaveBeenCalledTimes(1);
      }finally{release?.();await f.stop();}
    });
    it.each(['completion','reset'])('serializes protected completion and Reset (%s first)',async first=>{
      const f=await fixture();const other=new TaskStore(h.rootDir(),undefined,{asyncLayer:h.layer()});
      let entered!:()=>void,release!:()=>void;
      const ready=new Promise<void>(r=>entered=r),barrier=new Promise<void>(r=>release=r);
      const original=persistence.upsertTaskRowInTransaction;
      let blocked=false;
      const spy=vi.spyOn(persistence,'upsertTaskRowInTransaction').mockImplementation(async(...args)=>{
        if(!blocked&&(first==='reset'||args[1].column==='done')){blocked=true;entered();await barrier;}
        return original(...args);
      });
      try{
        f.setMerged();
        const complete=()=>processPullRequestMergeTask(f.store,h.rootDir(),f.task.id,f.github as never,getTaskMergeBlocker,undefined,f.options.protectedMerge!).then(()=>({applied:true}),error=>({applied:false,error}));
        const reset=()=>other.resetTaskPublication(f.task.id,'in-review');
        const a=first==='completion'?complete():reset();await ready;
        const b=first==='completion'?reset():complete();release();const results=await Promise.all([a,b]);
        expect(results[first==='completion'?0:1]).toMatchObject({applied:first==='completion'});
        expect((await f.store.getTask(f.task.id)).column).toBe('in-review');
        expect((await f.store.getTask(f.task.id)).checkoutRunId).not.toBe('checkout-A');
        await expect(f.store.moveTask(f.task.id,'done',{protectedMerge:f.options.protectedMerge!})).rejects.toMatchObject({code:'merge-request-superseded'});
      }finally{release?.();spy.mockRestore();await f.stop();}
    });
    it('retains committed completion when cancellation races its acknowledgement',async()=>{
      const f=await fixture();const controller=new AbortController();
      const abortOnDone=({task}:any)=>{if(task.id===f.task.id&&task.column==='done')controller.abort();};
      f.store.on('task:moved',abortOnDone);
      try{f.setMerged();
        const result=await f.engine.requestInterpreterMerge(f.task.id,{...f.options,signal:controller.signal}).catch(error=>({error:error.message}));
        await (f.engine as any).mergeBodyInFlight?.catch(()=>undefined);
        expect((await f.store.getTask(f.task.id)).column).toBe('done');
        expect(result).toMatchObject({error:expect.stringMatching(/aborted/i)});
        const committed=await f.store.getTask(f.task.id);
        console.log('COMMITTED_ABORT_ACK',JSON.stringify({result,column:committed.column,mergeDetails:committed.mergeDetails,prInfo:committed.prInfo,checkoutRunId:committed.checkoutRunId,checkoutLeaseEpoch:committed.checkoutLeaseEpoch}));
        expect(committed.mergeDetails).toMatchObject({mergeConfirmed:true,landedBranchTipSha:f.options.protectedMerge!.expectedHeadOid,mergedAt:expect.any(String)});
        expect(committed.prInfo).toMatchObject({number:9,status:'merged',headOid:f.options.protectedMerge!.expectedHeadOid});
        await expect.poll(()=>remote.close.mock.calls.length).toBe(1);
      }finally{f.store.off('task:moved',abortOnDone);await f.stop();}
    });

    it('consumes the registered workflow UUID proof through the actual graph name context',async()=>{
      const f=await fixture();try{f.setMerged();
        const executor=new TaskExecutor(f.store,h.rootDir());executor.setMergeRequester(f.engine.requestInterpreterMerge.bind(f.engine));
        const primitives=(executor as any).createAuthoritativeWorkflowPrimitives(await f.store.getSettings());
        const selected=await f.store.getWorkflowDefinition(f.options.protectedMerge!.workflowId);
        const contexts:string[]=[];
        const graph=new WorkflowGraphExecutor({runId:'real-graph-run',primitives,runCustomNode:async(node,_task,context)=>{
          expect(node.id).toBe('review');
          contexts.push(String(context['workflow:id']));
          return {outcome:'success',contextPatch:{'workflow:protected-merge':{expectedHeadOid:f.options.protectedMerge!.expectedHeadOid,admission:f.options.protectedMerge!.admission,taskId:f.task.id,workflowId:selected!.id,runId:context['workflow:run-id']}}};
        }});
        const result=await graph.run(await f.store.getTask(f.task.id),await f.store.getSettings(),selected!.ir);
        expect(contexts.length).toBeGreaterThan(0);
        expect(contexts.every(name=>name===selected!.ir.name)).toBe(true);
        expect(result.visitedNodeIds).toContain('merge');
        console.log('REGISTERED_GRAPH_RESULT',JSON.stringify({result,nodes:selected!.ir.nodes}));
        expect(result.outcome).toBe('success');expect((await f.store.getTask(f.task.id)).column).toBe('done');
        expect(result.context['workflow:merge-status']).toBe('merged');
        await expect.poll(()=>remote.close.mock.calls.length).toBe(1);
      }finally{await f.stop();}
    });

});
