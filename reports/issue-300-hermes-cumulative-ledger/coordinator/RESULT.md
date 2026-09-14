# Core Hermes cumulative ledger acceptance

Evidence mode: fallback, exact source review and coordinator execution. Issue #300 approved core-only scope. Source b9ab66c1fd5d08257e2545e95c362e7f98211b0a, integrated as 63c4302ad1d54de561a41b1dd61dcedc397ac09e over 830cacd7c2992864328f1e3741fa1564d406e4d4.

Claude Sonnet 5 independently reviewed exact source and returned PASS, no blockers. Coordinator replay: 17 actual isolated PostgreSQL tests and 5 unit tests pass, explicit test exit 0, own PG stopped and port 64119 closed. Source lint, changeset validation and git diff --check subsequently ran together and exited 0, addressing review note N1 about empty archived output. Integrated core build also exited 0.

N2 (baseline:false with cursor phase baseline) is retained as a nonblocking contract note for the future host caller; no present caller exists and no unapproved state-machine extension is inferred. The host must issue baseline phase only for its actual initial historical observation. The core slice accepts actual native-row ownership and supplied observed cumulative usage; it does not prove child persistence completeness, fresh host settings, physical provider coverage, a registered budget channel, or runtime acceptance. No public push/deployment.

Negative evidence: the original RED runner cleanup could mask its shell exit; preserved RED content reports real failures and final runner assigns exit after cleanup. Projection failure may follow committed usage; retry idempotency is proven, not rollback of a committed transaction. Shared unknown future spend is not reserved by this ledger.

Integrated engine consumer typecheck against the newly built core exited 0. The preceding native Git amendment integrated engine build also exited 0 (/tmp/303-native-author-git-integrated-build.log), completing its previously pending build verification.
