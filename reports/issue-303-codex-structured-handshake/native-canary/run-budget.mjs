import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const state=JSON.parse(readFileSync('/tmp/agents303-pilot-state.json','utf8'));
const env=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','SHELL','USER','LOGNAME'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{HOME:state.isolatedHome,FUSION_NODE_ID:'agents303-native-pilot',FUSION_SKIP_ONBOARDING:'1'});
const child=spawn('/Users/man/.hermes/node/bin/node',['/tmp/303-structured-native-canary/budget.mjs',...process.argv.slice(2)],{cwd:state.projectRoot,env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});
