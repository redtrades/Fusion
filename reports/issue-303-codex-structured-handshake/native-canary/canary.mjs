import { readFile, writeFile, realpath, mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const here='/tmp/303-structured-native-canary', fusion='/Users/man/worktrees/Fusion/300-live-integration';
const sha='a83b0e29218c55f35d87fe4b7b745d037b09f51e';
const control=JSON.parse(await readFile(here+'/control.json','utf8'));
const flags=process.argv.slice(2);
if(flags.length>1||flags.some(arg=>!['--preflight','--admit-only','--execute'].includes(arg)))throw new Error('Unknown canary option');
const execute=flags.includes('--execute'),preflight=flags.length===0||flags.includes('--preflight');
if(!control.exclusivePilotDatabase || control.sourceRevision!==sha) throw new Error('Root must review controls and confirm exclusive isolated database ownership');
if(execute&&!control.allowOneRequest) throw new Error('Model request not authorized in control');
if(!preflight&&(!control.model || control.model==='ROOT_SELECT_EXISTING_MODEL' || control.modelProvider!=='openai')) throw new Error('Root must select the existing native model/provider');
const state=JSON.parse(await readFile('/tmp/agents303-pilot-state.json','utf8'));
const admitted=JSON.parse(await readFile(state.stateRoot+'/native-admission-receipt.json','utf8'));
if(process.env.HOME!==state.isolatedHome || process.env.CODEX_HOME!=='/Users/man/.codex' || process.env.DATABASE_URL || process.env.PORT) throw new Error('Canary environment isolation mismatch');
if(execFileSync('git',['-C',fusion,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==sha) throw new Error('Frozen source revision changed');
const manifest=JSON.parse(await readFile(here+'/build-manifest.json','utf8'));
for(const [path,hash] of Object.entries(manifest)) if(createHash('sha256').update(await readFile(fusion+'/'+path)).digest('hex')!==hash) throw new Error('Frozen compiled artifact changed');
const load=p=>import(pathToFileURL(fusion+'/'+p).href);
const {createTaskStoreForBackend}=await load('packages/core/dist/postgres/startup-factory.js');
const {CliSessionStore}=await load('packages/core/dist/cli/cli-session-store.js');
const {CliSessionManager}=await load('packages/engine/dist/cli-agent/session-manager.js');
const {CliAdapterRegistry}=await load('packages/engine/dist/cli-agent/adapter.js');
const {codexAdapter}=await load('packages/engine/dist/cli-agent/adapters/codex.js');
const {TelemetryHub}=await load('packages/engine/dist/cli-agent/telemetry-hub.js');
const {launchCliTaskSession}=await load('packages/engine/dist/cli-agent/task-session.js');
const {inspectCliTokenBudget}=await load('packages/engine/dist/cli-agent/token-budget-capability.js');
const {resolveTaskTokenBudget,getTokenBudgetUsage}=await load('packages/engine/dist/concurrency/token-budget-enforcer.js');
const mode=preflight?'preflight':execute?'one-request':'admit-only';
const report={sourceRevision:sha,mode,startedAt:new Date().toISOString(),promptAttempts:0,promptSent:false,accountingAccepted:false,checkpoints:[],metadataOnly:true};
const receipt=here+'/'+mode+'-'+Date.now()+'.json';
let boot,sessions,manager,handle,exit,timer;
const persist=()=>writeFileSync(receipt,JSON.stringify(report,null,2)+'\n',{mode:0o600});
const stop=()=>{report.cancelled=true;if(handle)void handle.kill();else manager?.killAll();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try {
 boot=await createTaskStoreForBackend({rootDir:state.projectRoot});
 const store=boot.taskStore;
 if(store.getProjectId()!==admitted.projectId||admitted.taskId!=='KB-002')throw new Error('Wrong isolated task/project');
 const task=await store.getTask(admitted.taskId);
 if(task.proposalClaimId!=='github:redtrades/agents#303'||task.autoMerge!==false||task.paused||task.userPaused)throw new Error('Isolated task is not available for canary');
 const lease={runId:task.checkoutRunId,leaseEpoch:task.checkoutLeaseEpoch,agentId:task.checkedOutBy,nodeId:task.checkoutNodeId};
 if(JSON.stringify(lease)!==JSON.stringify(admitted.lease))throw new Error('Recorded native admission is stale');
 if(await realpath(task.worktree)!==await realpath(admitted.worktreePath))throw new Error('Native task cwd changed');
 const head=execFileSync('git',['-C',task.worktree,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(head!==admitted.head)throw new Error('Admitted worktree head changed');
 sessions=await CliSessionStore.create(boot.asyncLayer,admitted.projectId);
 const query={taskId:task.id,adapterId:'codex',admission:lease};
 const scopes=await store.getSettingsByScope();
 const resolved=resolveTaskTokenBudget(task,scopes.project,scopes.global);
 const positive=Number.isSafeInteger(resolved.hard)&&resolved.hard>0;
 Object.assign(report,{projectId:admitted.projectId,taskId:task.id,lease,worktree:task.worktree,head,requestedModel:control.model,requestedProvider:control.modelProvider,
   preflight:{resolvedBudget:resolved,finitePositiveHard:positive,observedWorkTokens:getTokenBudgetUsage(task.tokenUsage),taskPaused:!!task.paused,column:task.column,taskBudgetOverride:task.tokenBudgetOverride??null,projectBudget:scopes.project.taskTokenBudget??null,globalBudget:scopes.global.taskTokenBudget??null,taskAutoMerge:task.autoMerge}});
 if(preflight){ report.preflightComplete=true; }
 else {
 const before=await inspectCliTokenBudget(store,sessions,query);
 if(!Number.isSafeInteger(before.hardLimit)||before.hardLimit<=0||before.launchGate!=='native-structured-identity-before-prompt'||before.hardLimit!==control.expectedHardLimit||before.observedWorkTokens>=before.hardLimit)throw new Error('Finite positive native budget must match reviewed control');
 report.before=before;
 if(report.cancelled)throw new Error('Canary cancelled before native launch');
 const hub=new TelemetryHub({store:sessions}), registry=new CliAdapterRegistry();registry.register(codexAdapter);
 manager=new CliSessionManager({store:sessions,registry});
 const inject=manager.inject.bind(manager);
 manager.inject=async(id,text)=>{
   report.promptAttempts++;
   const native=sessions.getSession(id);report.nativeSession={id,nativeSessionId:native?.nativeSessionId};
   persist(); // Only metadata, before the sole possible model request.
   if(!execute)throw new Error('ADMIT_ONLY_REQUEST_BLOCKED');
   if(report.promptAttempts!==1||text!==control.prompt||report.cancelled)throw new Error('Canary request control mismatch');
   report.modelRequestAttempted=true;report.promptSent=null;persist();await inject(id,text);report.promptSent=true;
 };
 const accounting={recordCliTokenUsageFenced:async(id,input)=>{
   const ack=await store.recordCliTokenUsageFenced(id,input);
   report.checkpoints.push({sessionId:input.sessionId,nativeSessionId:input.nativeSessionId,fresh:input.fresh===true,reaffirm:input.reaffirm===true,baseline:input.baseline,cursor:input.cursor,observations:input.observations,hardExceeded:ack.hardExceeded,observedWorkTokens:ack.observedWorkTokens});
   persist();return ack;
 }};
 timer=setTimeout(stop,90000);
 handle=await launchCliTaskSession({taskId:task.id,projectId:admitted.projectId,worktreePath:task.worktree,prompt:control.prompt,config:{cliAdapterId:'codex',settings:{command:'/Users/man/.local/bin/codex',model:control.model,modelProvider:control.modelProvider}},manager,hub,registry,hookDirRoot:here,hookEndpointUrl:'http://127.0.0.1:9/unused-structured-path',usageProtection:{store:accounting,sessions,admission:lease,limits:{hard:before.hardLimit}},log:()=>{}});
 exit=manager.waitForExit(handle.sessionId);
 report.outcome=await handle.result();
 report.after=await inspectCliTokenBudget(store,sessions,{...query,sessionId:handle.sessionId});
 report.usageDelta=report.after.observedWorkTokens-before.observedWorkTokens;
 if(execute){
   if(report.outcome.kind!=='success'||report.after.session?.phase!=='drained'||report.promptAttempts!==1||!report.checkpoints.some(c=>c.observations.length&&!c.baseline))throw new Error('Native accounting acceptance not established');
   report.accountingAccepted=true;await handle.reap();
 }else{
   if(report.promptSent||report.promptAttempts!==1||report.usageDelta!==0||!report.checkpoints.some(c=>c.fresh&&c.cursor.phase==='awaiting-file')||!report.checkpoints.some(c=>c.reaffirm))throw new Error('No-turn admission proof incomplete');
   report.noTurnAdmissionEstablished=true;
 }
 }
}catch(error){report.failureClass=error?.name??'Error';report.failure=/^(Wrong isolated|Isolated task|Recorded native|Native task cwd|Admitted worktree|Finite positive|Native accounting acceptance|No-turn admission|Canary |Unsupported Codex|CLI token|Native pending)/.test(error?.message??'')?error.message:'Native setup or execution failed; inspect scoped metadata';process.exitCode=1;}
finally{
 clearTimeout(timer);
 if(handle)await handle.kill();manager?.dispose();
 if(exit)await exit;
 if(sessions)await sessions.flush();
 if(boot)await boot.shutdown();
 report.cleanedUp=true;report.finishedAt=new Date().toISOString();persist();
 console.log(JSON.stringify({receipt,mode,preflightComplete:report.preflightComplete??false,preflight:report.preflight,promptAttempts:report.promptAttempts,promptSent:report.promptSent,noTurnAdmissionEstablished:report.noTurnAdmissionEstablished??false,accountingAccepted:report.accountingAccepted,cleanedUp:report.cleanedUp,failure:report.failure??null}));
}
