import EmbeddedPostgres from '/Users/man/worktrees/Fusion/300-cli-observed-token-budget/packages/core/node_modules/embedded-postgres/dist/index.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
const listener=net.createServer(); await new Promise(r=>listener.listen(0,'127.0.0.1',r)); const port=listener.address().port; await new Promise(r=>listener.close(r));
const root=await mkdtemp(join(tmpdir(),'fusion268-branch-fix-pg-'));
const pg=new EmbeddedPostgres({databaseDir:join(root,'data'),port,user:'postgres',password:'test-only',persistent:false,postgresFlags:['-c','listen_addresses=127.0.0.1'],onLog:()=>{},onError:console.error});
let testExit = 1;
try {
 await pg.initialise(); await pg.start();
 console.log('Isolated test database ready on ephemeral port',port);
 const child=spawn('pnpm',['--filter','@fusion/core','exec','vitest','run','src/__tests__/postgres/deterministic-step-projection.pg.test.ts','src/__tests__/postgres/store-update-step-order.pg.test.ts','src/__tests__/postgres/proactive-step-status.pg.test.ts','src/__tests__/postgres/hybrid-step-storage-contract.pg.test.ts','--no-file-parallelism','--maxWorkers=1','--reporter=dot'],{cwd:'/Users/man/worktrees/Fusion/268-projection-branch-fix',stdio:'inherit',env:{...process.env,FUSION_PG_TEST_URL_BASE:`postgresql://postgres:test-only@127.0.0.1:${port}`,FUSION_PG_TEST_SKIP:'0'}});
 testExit=await new Promise(resolve=>child.on('exit',(code,signal)=>{ console.log("TEST_CHILD_EXIT",code,signal); resolve(code ?? 1); }));
 console.log("BEFORE_PG_STOP_TEST_EXIT",testExit);
 await writeFile("/tmp/fusion268-branch-fix-child-exit.json",JSON.stringify({code:testExit}));
} finally { process.exitCode = testExit; await pg.stop(); }
process.exitCode = Number.isInteger(testExit) ? testExit : 1;
