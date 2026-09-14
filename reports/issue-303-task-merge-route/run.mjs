import EmbeddedPostgres from '/Users/man/worktrees/Fusion/300-terminal-release/packages/core/node_modules/embedded-postgres/dist/index.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
const listener=net.createServer(); await new Promise(r=>listener.listen(0,'127.0.0.1',r)); const port=listener.address().port; await new Promise(r=>listener.close(r));
const root=await mkdtemp(join(tmpdir(),'fusion300-composed-outer-pg-'));
const pg=new EmbeddedPostgres({databaseDir:join(root,'data'),port,user:'postgres',password:'test-only',persistent:false,postgresFlags:['-c','listen_addresses=127.0.0.1'],onLog:()=>{},onError:console.error});
try {
 await pg.initialise(); await pg.start();
 console.log('Isolated test database ready on ephemeral port',port);
 const child=spawn('/Users/man/worktrees/Fusion/300-live-integration/packages/core/node_modules/.bin/vitest',['run','--config','/tmp/303-task-merge-route.vitest.config.mts','--reporter=verbose'],{cwd:'/Users/man/worktrees/Fusion/303-task-merge-route-proof',stdio:'inherit',env:{...process.env,FUSION_ROOT:'/Users/man/worktrees/Fusion/300-live-integration',FUSION_PG_TEST_URL_BASE:`postgresql://postgres:test-only@127.0.0.1:${port}`,FUSION_PG_TEST_SKIP:'0'}});
 process.exitCode=await new Promise(resolve=>child.on('exit',resolve));


} finally { await pg.stop(); console.log('Isolated database stopped'); }
