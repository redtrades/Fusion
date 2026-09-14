# Exact revision review disposition

Evidence mode: immutable Git source, independent Claude desktop and actual Hermes free-model review, followed by coordinator integration checks.

Final source: 5ed29e14ff04e7998b2e4310a6c601a6a13f433e, parent ed4de5149e2ce84e857cd0b3ae68999408119ea0, original base 0e2ee6dc26329caebb21b605af947e7039ad508e. Integrated unchanged as 7f9be32b2 and a83b0e292 atop33d092197.

Claude (Anthropic desktop, UI-selected Sonnet 5 High) returned PASS on final source after independently comparing all17 exported file hashes with Git objects. Actual provider token instrumentation is unavailable. Original ed4 review is withdrawn as exact-revision approval: it mixed mutable followup source with the ed4 diff and missed the real pending-path defect. Original retained unchanged.

Hermes actual nous/upstage/solar-pro4:free initial ed4 PASS also missed that defect. The first final-followup request returned a promise to read files, not a verdict, despite inline source and no tools. One bounded corrected prompt returned PASS. Final two attempts total35,351tokens/4APIcalls, estimatedUSD0, actual billed unknown. The successful review is scoped to supplied pending-accounting followup and callers, not an independent whole-runtime certification. Its claim that the existing beforeFirstRequest assignment moved is incorrect and immaterial; source patch did not move that assignment. Raw outputs and native usage remain unchanged.

The pending fix checks current durable usage/ownership against admitted limits before the first request. It does not atomically couple a DB transaction with remote dispatch, reread later policy-limit edits, or prove real native runtime acceptance. Eight WS1.7 checks and three qualifying real traversals remain separate and open.

## Coordinator composed verification

On integrateda83b0e292: core and engine TypeScript builds pass. Targeted engine tests33PASS across six files, core ledger3PASS, actual isolated PostgreSQL5PASS:41total, no skips. The first engine command accidentally named nonexistent cli-token-usage-observer.test.ts, which Vitest silently ignored while running the other five files30PASS; the actual cli-token-usage.test.ts then independently passed3. No fabricated six-file result for the first invocation. PG child exited0; exact ephemeralport51717 has no listener afterward. No model request occurred in these synthetic tests.

Logs retained in coordinator-logs/.
