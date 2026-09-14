import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { createSharedPgTaskStoreTestHarness, pgDescribe } from '../../../core/src/__test-utils__/pg-test-harness.js';
import { WorkflowGraphTaskRunner } from '../workflows/workflow-graph-task-runner.js';
import { PrReconciler } from '../merge/pr-reconcile.js';
import { TaskExecutor } from '../executor.js';
import { GitHubSourceIssueCloseService } from '../../../dashboard/src/github-source-issue-close.js';
const provider = vi.hoisted(() => ({ close: vi.fn(), getIssue: vi.fn() }));
vi.mock('../../../dashboard/src/github.js', () => ({ GitHubClient: class {setIssueState=provider.close;getIssue=provider.getIssue;} }));
vi.mock('../../../dashboard/src/github-auth.js', () => ({resolveGithubTrackingAuth:()=>({ok:true,auth:{mode:'gh-cli'}})}));
pgDescribe('real PR entity reconciliation to task completion',()=>{
 const h=createSharedPgTaskStoreTestHarness({prefix:'pr_completion_bridge',projectId:'proj-pr-completion'});
 beforeAll(h.beforeAll);beforeEach(h.beforeEach);afterEach(h.afterEach);afterAll(h.afterAll);
 it.each([false,true])('requires a native completion bridge after corroborated merge (declared complete column: %s)',async completeColumn=>{
  const store=h.store();
  await store.updateSettings({githubCloseSourceIssueOnDone:true});
  const workflow=await store.createWorkflowDefinition({name:'selected PR completion slice',ir:{version:'v2',name:'selected PR completion slice',columns:[{id:'in-progress',name:'WIP',traits:[{trait:'wip'}]},...(completeColumn?[{id:'done',name:'Done',traits:[{trait:'complete'}]}]:[])],nodes:[{id:'start',kind:'start',column:'in-progress'},{id:'pr-create',kind:'pr-create',column:'in-progress'},{id:'pr-merge',kind:'pr-merge',column:'in-progress'},{id:'end',kind:'end',column:'in-progress'}],edges:[{from:'start',to:'pr-create'},{from:'pr-create',to:'pr-merge',condition:'outcome:open'},{from:'pr-merge',to:'end',condition:'outcome:merged-requested'}]}} as never);
  const task=await store.createTask({title:'real PR bridge fixture',description:'no model execution',column:'in-progress',workflowId:workflow.id,proposalClaimId:'fixture:303',sourceIssue:{provider:'github',repository:'fixture/repo',externalIssueId:'303',issueNumber:303}});
  provider.close.mockReset();provider.getIssue.mockReset();
  provider.close.mockResolvedValue(undefined);provider.getIssue.mockResolvedValue({state:'open'});
  const service=new GitHubSourceIssueCloseService(store);service.start();
  const head='1'.repeat(40), merge=vi.fn(async()=>({status:'merged-requested' as const,headOid:head}));
  const noop=async()=>({outcome:'success' as const});
  const runner=new WorkflowGraphTaskRunner({store,seams:{planning:noop,execute:noop,review:noop,merge:noop,schedule:noop},runCustomNode:noop,
   prNodes:{getStore:()=>store,resolvePrSource:()=>({sourceType:'task',sourceId:task.id,repo:'fixture/repo',headBranch:'fixture-303',baseBranch:'main'}),createPr:async()=>({prNumber:9,prUrl:'https://github.com/fixture/repo/pull/9',headOid:head}),mergePr:merge}});
  const executor=new TaskExecutor(store,h.rootDir());
  const reconcile=new PrReconciler({store,ops:{probe:async()=>({changed:true}),fetchPrState:async()=>({exists:true,prState:'merged',prNumber:9,prUrl:'https://github.com/fixture/repo/pull/9',headOid:head})}});
  try {
   const result=await runner.run(task as never,undefined);
   expect(result.disposition).toBe('completed');expect(merge).toHaveBeenCalledTimes(1);
   const entity=await store.getActivePrEntityBySource('task',task.id);expect(entity?.state).toBe('open');
   expect((await store.getTask(task.id)).mergeDetails?.mergeConfirmed).not.toBe(true);
   expect(provider.close).not.toHaveBeenCalled();
   const transitions=await reconcile.reconcileRepoOnce('fixture/repo');
   expect(transitions.some(t=>t.event==='merged')).toBe(true);
   await expect.poll(async()=>(await store.getPrEntity(entity!.id))?.state).toBe('merged');
   // Call the actual TaskExecutor finalization seam; never manufacture mergeConfirmed/done.
   const finalized=await (executor as any).finalizeMergeConfirmedWorkflowGraphTask(task.id,'graph-completed');
   const current=await store.getTask(task.id);
   console.log('BRIDGE_RECEIPT',JSON.stringify({completeColumn,taskId:task.id,workflowId:workflow.id,graph:result.disposition,entityId:entity!.id,entityState:(await store.getPrEntity(entity!.id))?.state,column:current.column,mergeConfirmed:current.mergeDetails?.mergeConfirmed??null,finalized,issueCloseCalls:provider.close.mock.calls.length,transitions}));
   expect(finalized).toBe(true);
   expect(current.column).toBe('done');
   await expect.poll(()=>provider.close.mock.calls.length).toBe(1);
  } finally {reconcile.stopAll();service.stop();}
 });
});
