import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import net from 'node:net';
import { spawn } from 'node:child_process';
const repoRoot = resolve(process.env.FUSION_REVIEW_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)));
const { default: EmbeddedPostgres } = await import(pathToFileURL(join(repoRoot, 'packages/core/node_modules/embedded-postgres/dist/index.js')).href);
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const root = await mkdtemp(join(tmpdir(), 'fusion303-protected-merge-pg-'));
const pg = new EmbeddedPostgres({ databaseDir: join(root, 'data'), port, user: 'postgres', password: 'test-only', persistent: false, postgresFlags: ['-c', 'listen_addresses=127.0.0.1'], onLog: () => {}, onError: console.error });
let status = 1;
try {
  await pg.initialise();
  await pg.start();
  console.log('Isolated test database ready on ephemeral port', port);
  const child = spawn(join(repoRoot, 'packages/core/node_modules/.bin/vitest'), ['run', '--config', join(repoRoot, 'reports/issue-303-task-merge-route/protected.vitest.config.mts'), '--reporter=verbose'], {
    cwd: repoRoot, stdio: 'inherit', env: { ...process.env, FUSION_ROOT: repoRoot, FUSION_PG_TEST_URL_BASE: `postgresql://postgres:test-only@127.0.0.1:${port}`, FUSION_PG_TEST_SKIP: '0' },
  });
  status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally {
  await pg.stop();
  console.log('Isolated database stopped');
}
process.exitCode = status;
