import EmbeddedPostgres from '/Users/man/worktrees/Fusion/300-hermes-cumulative-ledger/packages/core/node_modules/embedded-postgres/dist/index.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
const listener=net.createServer(); await new Promise(r=>listener.listen(0,'127.0.0.1',r)); const port=listener.address().port; await new Promise(r=>listener.close(r));
const root=await mkdtemp(join(tmpdir(),'fusion303-structured-pg-'));
const pg=new EmbeddedPostgres({databaseDir:join(root,'data'),port,user:'postgres',password:'test-only',persistent:false,postgresFlags:['-c','listen_addresses=127.0.0.1'],onLog:()=>{},onError:console.error});
let testExit = 1;
try {
 await pg.initialise(); await pg.start();
 console.log('Isolated test database ready on ephemeral port',port);
 const child=spawn('pnpm',['--filter','@fusion/core','exec','vitest','run','src/__tests__/postgres/cli-token-usage-fenced.pg.test.ts','--reporter=dot'],{cwd:'/Users/man/worktrees/Fusion/300-hermes-cumulative-ledger',stdio:'inherit',env:{...process.env,FUSION_PG_TEST_URL_BASE:`postgresql://postgres:test-only@127.0.0.1:${port}`,FUSION_PG_TEST_SKIP:'0'}});
 testExit=await new Promise((resolve,reject)=>{ child.on('error',reject); child.on('exit',code=>resolve(code ?? 1)); });
 console.log("Vitest exit",testExit);
} finally { await pg.stop(); process.exitCode = testExit; console.log("Owned PostgreSQL stopped; test exit", testExit); }
