# Setup failures and preservation limits

The gzipped files are lossless copies of the surviving `/tmp` logs, including
control characters and whitespace. The manifest records hashes of uncompressed
bytes. No test output was edited or normalized.

Two setup errors preceded the preserved RED runs:

1. `pnpm exec vitest` from the workspace root failed with
   `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "vitest" not found`.
   Corrected to `pnpm --filter @fusion/engine exec vitest ...`.
2. Initial isolated embedded PG initialization aborted because
   `@loader_path/../lib/libpq.5.dylib` was missing from the disposable installed
   dependency. Installation had used `--ignore-scripts`. Running the package's
   `scripts/hydrate-symlinks.js` from the workspace root did nothing because the
   script resolves `native/pg-symlinks.json` from its working directory. Running
   it from the installed `@embedded-postgres/darwin-arm64` package directory
   restored its native links; the isolated PG RED then ran.

Those first failures were displayed in tool output, but their `/tmp` output
paths were reused for the subsequent RED runs. Their original complete raw
files no longer exist. This note preserves the observed failure and commands;
it is not presented as an original lossless transcript. In particular,
`303-identity-pg-red.log.gz` is the subsequent genuine failing regression run,
not the earlier missing-dylib failure.

Exact dependency commands used:

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts
node node_modules/.pnpm/@embedded-postgres+darwin-arm64@15.18.0-beta.17/node_modules/@embedded-postgres/darwin-arm64/scripts/hydrate-symlinks.js
```

The second command above was the ineffective root-directory invocation.
Successful invocation, with working directory set to that installed package:

```sh
node scripts/hydrate-symlinks.js
```

No existing profile, global service or database was changed. The owned test
runner created an ephemeral data directory/port and stopped its server in
`finally`. Its explicit password is a disposable local test fixture value.
