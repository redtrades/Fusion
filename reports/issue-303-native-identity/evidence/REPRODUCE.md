# Composed verification

Run in the target composed Fusion checkout after integrating source
`c7d04532315ce85fd072a33f4446b79edb905065`. These commands perform deterministic
fixture tests and isolated PostgreSQL tests, not real CLI/model inference.
Dependencies must be installed in this checkout. If offline installation used
`--ignore-scripts`, hydrate the installed embedded-postgres platform package's
native links from that package directory as described in SETUP-FAILURES.md.

## Builds and focused tests

```sh
pnpm --filter @fusion/core build
pnpm --filter @fusion/engine build
pnpm --filter @fusion/engine exec vitest run src/__tests__/cli-observed-identity.test.ts src/__tests__/cli-token-usage.test.ts src/__tests__/cli-token-budget-pipeline.test.ts src/__tests__/codex-structured-handshake.test.ts src/__tests__/cli-codex-structured-pipeline.test.ts src/__tests__/cli-token-budget-capability.test.ts
pnpm --filter @fusion/core exec vitest run src/__tests__/cli-token-usage-ledger.test.ts
pnpm exec eslint packages/core/src/cli/cli-token-usage-types.ts packages/core/src/task-store/cli-token-usage-ops.ts packages/engine/src/cli-agent/codex-app-server-session.ts packages/engine/src/cli-agent/task-session.ts packages/engine/src/cli-agent/token-budget-capability.ts packages/engine/src/cli-agent/token-usage-observer.ts packages/engine/src/cli-agent/token-usage.ts
node scripts/check-changeset-format.mjs
git diff --check
```

Original result: engine 39 PASS, ledger 3 PASS; builds and production lint PASS.

## Exact isolated PG runner, relocated to the composed checkout

`303-identity-pg-run.mjs` is the exact original owned runner. Its two absolute
checkout references are environment paths, not authority. The following creates
a disposable relocated copy without modifying the archived original:

```sh
python3 - <<'PY'
from pathlib import Path
import tempfile
root = str(Path.cwd())
source = Path('reports/issue-303-native-identity/evidence/303-identity-pg-run.mjs').read_text()
old = '/Users/man/worktrees/Fusion/303-native-identity-binding'
assert source.count(old) == 2
# Paths are JavaScript single-quoted literals; refuse unsupported path characters.
assert not any(c in root for c in "'\\\n\r")
with tempfile.NamedTemporaryFile(mode='w', suffix='.mjs', prefix='fusion-identity-pg-', delete=False) as f:
    f.write(source.replace(old, root))
    print(f.name)
PY
```

Run `node` on the printed temporary filename. It starts only its own new
embedded PG instance on a dynamically allocated loopback port, passes the
explicit test URL to the existing PG suite, and stops the instance in `finally`.
Original result: 9 PASS. Do not substitute an existing application's database.
Remove only the temporary runner you created after completion.

## Verify lossless archives

```sh
python3 - <<'PY'
from pathlib import Path
import gzip, hashlib, json
root = Path('reports/issue-303-native-identity/evidence')
for item in json.loads((root/'manifest.json').read_text())['artifacts']:
    data = (root/item['artifact']).read_bytes()
    if item['artifact'].endswith('.gz'):
        assert hashlib.sha256(data).hexdigest() == item['gzipSha256']
        data = gzip.decompress(data)
    assert len(data) == item['rawBytes']
    assert hashlib.sha256(data).hexdigest() == item['rawSha256']
print('All archived bytes verified')
PY
```
