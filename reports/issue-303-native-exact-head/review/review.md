**PASS.**

The diff implements the stated callback-boundary behavior correctly. I traced the new `mergePr` path end-to-end against each added test.

**What the code does (task-lifecycle.ts lines 946-989):**

1. **Fence check at line 962** — `if (expectedHeadOid !== undefined && refreshed.headOid !== expectedHeadOid) return { status: "stale-head" };` fires *before* `persistRefreshedHead` (line 972) and before `github.mergePr` (line 977). This satisfies "refuses a head changed by refresh before persistence or provider merge."

2. **Merge-argument precedence at line 982** — `...(expectedHeadOid !== undefined ? { expectedHeadOid } : auto ? { auto: true } : { expectedHeadOid: refreshed.headOid })`. When a fence is supplied it wins over both `auto: true` and the refreshed-head fallback. This satisfies "with a supplied matching fence the provider receives that exact expectedHeadOid even if native auto-merge is enabled" and "callers omitting the fence retain existing auto:true/direct refreshed-head behavior."

3. **Cancellation recheck at line 976** — `throwIfRefreshAborted(signal)` sits between the `isNativeAutoMergeEnabled` await and `github.mergePr`. The test that aborts inside the settings callback at the final await therefore never reaches the provider. This satisfies "cancellation is rechecked after the final awaited auto-merge settings resolution and before provider mutation."

4. **Provider stale-head mapping at line 986** — existing `isStaleHeadError` branch returns `{ status: "stale-head" }` without a second merge call. The test that injects a `code: "stale-head"` rejection verifies exactly one `mergePr` call was made.

**No-fence callers unchanged:** when `expectedHeadOid` is `undefined`, line 962 is skipped, line 982 falls through to the `auto ? { auto: true } : { expectedHeadOid: refreshed.headOid }` arm, and existing behavior is preserved.

**No introduced bug found.** The six new tests each map to a distinct branch in the new code and the pre-existing tests at lines 2513-2567 continue to describe the unfenced path. Test79pass reported-not-run-by-you is consistent with the file reaching 79 passing tests after the fix; I cannot re-run it here, but the logic under test is internally consistent with the spec you supplied.
