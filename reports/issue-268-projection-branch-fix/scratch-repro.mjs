import assert from 'node:assert/strict';
import { parseWorkflowIr } from '/Users/man/worktrees/Fusion/268-protected-step-projection/packages/core/dist/workflows/workflow-ir.js';
import { runForeach } from '/Users/man/worktrees/Fusion/268-protected-step-projection/packages/engine/dist/workflows/workflow-graph-foreach.js';
const nodes = ['select', 'left', 'right', 'finish'].map(id => ({id,kind:'script',config:{scriptName:id,gateMode:'gate'}}));
const fe = {id:'fe',kind:'foreach',config:{source:'task-steps',mode:'sequential',isolation:'shared',template:{nodes,edges:[
 {from:'select',to:'left',condition:'outcome:passed'},
 {from:'select',to:'right',condition:'outcome:failed'},
 {from:'left',to:'finish',condition:'success'},
 {from:'right',to:'finish',condition:'success'},
]}}};
const ir = parseWorkflowIr({version:'v2',name:'conditional-scripts',columns:[{id:'work',name:'Work',traits:[]}],nodes:[{id:'start',kind:'start'},{id:'parse',kind:'parse-steps',config:{artifact:'PROMPT.md',parser:'markdown'}},fe,{id:'end',kind:'end'}],edges:[{from:'start',to:'parse'},{from:'parse',to:'fe'},{from:'fe',to:'end',condition:'success'}]});
assert.equal(ir.nodes[2].id,'fe');
async function run(projected) {
 const calls=[]; const states=[]; const steps=[{name:'One',status:'pending'}];
 const result=await runForeach(fe,{
  task:{id:'synthetic-branch',steps},runId:'synthetic-branch-run',steps,context:{},signal:new AbortController().signal,
  runTemplateNode:async node=>{calls.push(node.id);return {outcome:'success',value:'passed',contextPatch:{scriptSucceeded:true}};},
  shouldTraverseEdge:(edge,result)=> !edge.condition || edge.condition==='success' ? result.outcome==='success' : edge.condition==='failure' ? result.outcome==='failure' : result.value===edge.condition.slice('outcome:'.length),
  persistence:{saveInstanceState:state=>states.push(state.status)},
  ...(projected?{createDeterministicStepProjection:()=>({start:async()=>{calls.push('native-start');return true;},complete:async()=>{calls.push('native-done');return true;}})}:{}),
 });
 return {result,calls,states};
}
const baseline=await run(false); const projected=await run(true);
assert.equal(baseline.result.outcome,'success');
assert.deepEqual(baseline.calls,['select','left','finish']);
assert.equal(projected.result.outcome,'failure');
assert.equal(projected.result.value,'step-projection-completion-refused');
assert.deepEqual(projected.calls,['native-start','select','left','finish']);
assert(!projected.states.includes('completed'));
console.log(JSON.stringify({source:'e582139d5c352ad8fd52b7fcb27d658f1be09bc4',nativeIrValidation:'accepted',handler:'synthetic native-script-compatible passed result; no commands, DB, or inference',baseline,projected},null,2));
