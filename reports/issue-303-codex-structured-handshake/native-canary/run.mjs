import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const state = JSON.parse(readFileSync('/tmp/agents303-pilot-state.json','utf8'));
const env = Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','SHELL','USER','LOGNAME'].filter(key => process.env[key]).map(key => [key,process.env[key]]));
Object.assign(env,{HOME:state.isolatedHome,CODEX_HOME:'/Users/man/.codex',FUSION_NODE_ID:'agents303-native-pilot',FUSION_SKIP_ONBOARDING:'1'});
const child = spawn('/Users/man/.hermes/node/bin/node',['/tmp/303-structured-native-canary/canary.mjs',...process.argv.slice(2)],{cwd:state.projectRoot,env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
