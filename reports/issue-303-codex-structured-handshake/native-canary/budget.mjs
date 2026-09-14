import { readFile, writeFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root='/tmp/303-structured-native-canary',fusion='/Users/man/worktrees/Fusion/300-live-integration';
const source='a83b0e29218c55f35d87fe4b7b745d037b09f51e';
const args=process.argv.slice(2);if(args.length>1||args.some(x=>!['--read','--apply','--restore'].includes(x)))throw new Error('Unknown budget operation');
const mode=args[0]??'--read',desired={hard:50000};
const state=JSON.parse(await readFile('/tmp/agents303-pilot-state.json','utf8'));
const admission=JSON.parse(await readFile(state.stateRoot+'/native-admission-receipt.json','utf8'));
const control=JSON.parse(await readFile(root+'/control.json','utf8'));
if(!control.exclusivePilotDatabase||control.sourceRevision!==source)throw new Error('Root exclusive database ownership confirmation required');
if(process.env.HOME!==state.isolatedHome||process.env.DATABASE_URL||process.env.PORT)throw new Error('Budget script isolation mismatch');
if(execFileSync('git',['-C',fusion,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==source)throw new Error('Frozen source changed');
const manifest=JSON.parse(await readFile(root+'/build-manifest.json','utf8'));
for(const path of ['packages/core/dist/postgres/startup-factory.js','packages/core/dist/cli/cli-session-store.js'])if(createHash('sha256').update(await readFile(fusion+'/'+path)).digest('hex')!==manifest[path])throw new Error('Compiled native artifact changed');
const {createTaskStoreForBackend}=await import(pathToFileURL(fusion+'/packages/core/dist/postgres/startup-factory.js'));
const {CliSessionStore}=await import(pathToFileURL(fusion+'/packages/core/dist/cli/cli-session-store.js'));
const journalPath=root+'/task-budget-provisioning.json';
let boot;
const report={mode,sourceRevision:source,taskId:'KB-002',targetOverride:desired,startedAt:new Date().toISOString(),mutated:false};
const assertTask=task=>{
 if(task.id!=='KB-002'||task.proposalClaimId!=='github:redtrades/agents#303'||task.autoMerge!==false||task.checkoutRunId!==admission.lease.runId||task.checkoutLeaseEpoch!==admission.lease.leaseEpoch||task.checkedOutBy!==admission.lease.agentId||task.checkoutNodeId!==admission.lease.nodeId)throw new Error('Exact task/lease guard refused');
};
try {
 boot=await createTaskStoreForBackend({rootDir:state.projectRoot});const store=boot.taskStore;
 if(store.getProjectId()!==admission.projectId)throw new Error('Project guard refused');
 const task=await store.getTask('KB-002');assertTask(task);
 if(await realpath(task.worktree)!==await realpath(admission.worktreePath)||execFileSync('git',['-C',task.worktree,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==admission.head)throw new Error('Admitted worktree/head changed');
 const sessions=await CliSessionStore.create(boot.asyncLayer,admission.projectId);
 const active=sessions.listSessions({projectId:admission.projectId}).filter(row=>row.agentState!=='dead');
 report.activeNativeSessions=active.map(row=>({id:row.id,taskId:row.taskId,state:row.agentState}));
 report.currentOverride=task.tokenBudgetOverride??null;
 if(mode!=='--read'){
  if(active.length)throw new Error('Native sessions remain active; budget mutation refused');
  let liveCanary=[];
  try { liveCanary=execFileSync('pgrep',['-f','/tmp/303-structured-native-canary/(canary|run)\\.mjs([[:space:]]|$)'],{encoding:'utf8'}).trim().split(/\s+/).filter(Boolean); }
  catch(error){if(error.status!==1)throw new Error('Cannot verify absence of active canary process');}
  report.activeCanaryPids=liveCanary;
  if(liveCanary.length)throw new Error('Canary process active; budget mutation refused');
  const settingsBefore=JSON.stringify(await store.getSettingsByScope());
  let journal;
  if(mode==='--apply'){
   if(task.tokenBudgetOverride!=null)throw new Error('Existing task override must not be overwritten');
   journal={sourceRevision:source,projectId:admission.projectId,taskId:'KB-002',lease:admission.lease,head:admission.head,previousOverride:null,targetOverride:desired,preparedAt:new Date().toISOString(),applied:false};
   await writeFile(journalPath,JSON.stringify(journal,null,2)+'\n',{flag:'wx',mode:0o600});
  }else{
   journal=JSON.parse(await readFile(journalPath,'utf8'));
   if(!journal.applied||journal.restored||journal.previousOverride!==null||journal.sourceRevision!==source||journal.projectId!==admission.projectId||journal.taskId!=='KB-002'||JSON.stringify(journal.lease)!==JSON.stringify(admission.lease)||JSON.stringify(journal.targetOverride)!==JSON.stringify(desired))throw new Error('Matching applied provisioning receipt required');
  }
  // Supported TaskStore mutation; the callback checks the latest native task
  // under its process lock. Root's sole-owner control is REQUIRED: this is not
  // represented as a cross-process CAS or a new durable fencing API.
  await store.updateTaskAtomic('KB-002',current=>{
   assertTask(current);
   if(mode==='--apply' ? current.tokenBudgetOverride!=null : JSON.stringify(current.tokenBudgetOverride)!==JSON.stringify(desired))throw new Error('Task override changed; refusing to clobber another edit');
   return {tokenBudgetOverride:mode==='--apply'?desired:null};
  },{runId:admission.lease.runId,agentId:admission.lease.agentId,source:'issue303-canary-budget'});
  const after=await store.getTask('KB-002');assertTask(after);
  if(JSON.stringify(after.tokenBudgetOverride??null)!==JSON.stringify(mode==='--apply'?desired:null))throw new Error('Native budget verification mismatch');
  if(JSON.stringify(await store.getSettingsByScope())!==settingsBefore)throw new Error('Unexpected project/global settings change');
  report.mutated=true;report.afterOverride=after.tokenBudgetOverride??null;report.projectGlobalUnchanged=true;
  Object.assign(journal,mode==='--apply'?{applied:true,appliedAt:new Date().toISOString()}:{restored:true,restoredAt:new Date().toISOString()});
  await writeFile(journalPath,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
 }
}catch(error){report.failure=String(error?.message??'Native budget operation failed').slice(0,250);process.exitCode=1;}
finally{if(boot)await boot.shutdown();report.cleanedUp=true;report.finishedAt=new Date().toISOString();const path=root+'/budget-'+mode.slice(2)+'-'+Date.now()+'.json';await writeFile(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({receipt:path,...report}));}
