from pathlib import Path
import subprocess,hashlib,json
repo=Path('/Users/man/worktrees/Fusion/268-projection-branch-fix'); out=repo/'reports/issue-268-projection-branch-review'; out.mkdir()
head='ffefe982429f4103e8ae0fadbc4771a4bf9ee69f'; base='0cbfe89281ed41a1147466a03dc4deefb95f61f9'
def git(*a): return subprocess.check_output(['git',*a],cwd=repo)
paths=[p for p in git('diff','--name-only',base+'...'+head).decode().splitlines() if p.startswith(('packages/','.changeset/'))]
paths+=['AGENTS.md','reports/issue-268-protected-step-projection/PLAN.md','reports/issue-268-projection-branch-fix/PLAN.md']
manifest={'head':head,'base':base,'files':{}}
for p in paths:
 b=git('show',head+':'+p); target=out/'export'/p; target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b)
 manifest['files'][p]={'sha256':hashlib.sha256(b).hexdigest(),'gitBlob':git('rev-parse',head+':'+p).decode().strip(),'bytes':len(b)}
diff=git('diff','--no-ext-diff','--unified=30',base+'...'+head,'--','packages/','.changeset/')
(out/'source.diff').write_bytes(diff)
prompt='''Independent different-family exact-source code review. Implementer OpenAI/Codex; reviewer Nous/Solar via native Hermes. Use ONLY supplied source, NO TOOLS, do not claim tests run or other agents consulted. Return PASS or FIX, separate Spec and Standards findings with severity, exact path/line and concrete reproduction. If none, say none; do not invent participants or runtime acceptance.\n\nReview HEAD ffefe982429f4103e8ae0fadbc4771a4bf9ee69f, full cumulative protected-step change from BASE 0cbfe89281ed41a1147466a03dc4deefb95f61f9. Prior independent e582 review missed confirmed conditional branch regression and is invalidated; inspect final source afresh.\n\nApproved contract: shared sequential blocking named-script templates (excluding review/worktree/AI seam owners) may project task progress. Native accepted start must precede command. Every actually traversed script must have actual success, scriptSucceeded true, no notRunReason, no cancellation. Keep existing native chooseNextEdge/termination semantics, including conditional branches; do NOT require unselected siblings. Native accepted completion precedes instance completion. Completion mutation requires in-progress step and exact checkout tuple runId/leaseEpoch/agentId/nodeId plus ordered expectedSteps definitions (all except status, preserve missing dependsOn vs []), live nonpaused/nondeleted task and signal. Task lock -> transaction -> advisory lock -> project-scoped row FOR UPDATE -> checks -> shared policy -> owned fields -> abort before return -> postcommit effects. No nested atomicWriteTaskJson/public mutation in protected transaction. Legacy callers/policy unchanged. Explicitly NO identical-plan ABA/distinct samelease-attempt guarantee; no new attempt protocol or atomicity across task step and instance row is claimed.\n\nFocus: valid accepted-IR diamond select->left(outcome:passed)/right(outcome:failed)->finish; selected failure/unverified/skipped/cancelled must refuse completion. Check transactional stale Reset/release/plan/pause fences and all legacy behavior. Source tests report 91 engine and 40 actual PostgreSQL pass; engine build passes. These are implementer evidence, not tests you ran. Identify realistic introduced bugs, not unspecified stronger requirements. Governing standards excerpt/full files follow; mechanical formatting trivia need not repeat tooling.\n\n'''
prompt+='COMMIT LIST\n'+git('log','--oneline',base+'..'+head).decode()+'\nFULL CUMULATIVE CODE DIFF (30 context lines)\n'+diff.decode()
full=['AGENTS.md','packages/core/src/task-store/merge-queue-ops.ts','packages/engine/src/workflows/workflow-graph-foreach.ts','packages/engine/src/executor/deterministic-step-projection.ts','packages/engine/src/__tests__/workflow-deterministic-step-projection.test.ts','packages/core/src/__tests__/postgres/deterministic-step-projection.pg.test.ts','reports/issue-268-protected-step-projection/PLAN.md','reports/issue-268-projection-branch-fix/PLAN.md']
for p in full:
 txt=(out/'export'/p).read_text();prompt+='\nEXACT HEAD FILE '+p+' (line-numbered)\n'+''.join(f'{i}: {line}\n' for i,line in enumerate(txt.splitlines(),1))
# Exact native validator/edge-selection source context, not reviewer authority.
for p,lo,hi in [('packages/core/src/workflows/workflow-ir.ts',439,590),('packages/engine/src/workflows/workflow-graph-executor.ts',2000,2020)]:
 b=git('show',head+':'+p);target=out/'export'/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b)
 manifest['files'][p]={'sha256':hashlib.sha256(b).hexdigest(),'gitBlob':git('rev-parse',head+':'+p).decode().strip(),'bytes':len(b)}
 prompt+='\nEXACT HEAD CONTEXT '+p+'\n'+''.join(f'{i}: {line}\n' for i,line in enumerate(b.decode().splitlines(),1) if lo<=i<=hi)
assert len(prompt.encode())<=400000,len(prompt.encode())
(out/'prompt.txt').write_text(prompt)
manifest['promptBytes']=len(prompt.encode());manifest['promptSha256']=hashlib.sha256(prompt.encode()).hexdigest();manifest['diffSha256']=hashlib.sha256(diff).hexdigest()
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(out,manifest['promptBytes'],manifest['promptSha256'])
