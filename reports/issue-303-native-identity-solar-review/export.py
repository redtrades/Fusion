from pathlib import Path
import subprocess,hashlib,json
repo=Path('/Users/man/worktrees/Fusion/303-native-identity-binding');out=Path('/tmp/303-native-identity-solar-review');out.mkdir()
head='c7d04532315ce85fd072a33f4446b79edb905065';base='379c94d5e7c3bb824baf9b5c3705781904848c36'
def git(*a):return subprocess.check_output(['git',*a],cwd=repo)
paths=git('diff','--name-only',base+'...'+head).decode().splitlines()+['AGENTS.md']
m={'head':head,'base':base,'files':{}}
for p in paths:
 b=git('show',head+':'+p);f=out/'export'/p;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b)
 m['files'][p]={'sha256':hashlib.sha256(b).hexdigest(),'blob':git('rev-parse',head+':'+p).decode().strip(),'bytes':len(b)}
diff=git('diff','--no-ext-diff','--unified=12',base+'...'+head,'--','packages/','.changeset/');(out/'source.diff').write_bytes(diff)
prompt='''Independent different-family source review: OpenAI/Codex implementer; reviewer Nous/Solar through native Hermes. Review exact HEAD c7d04532315ce85fd072a33f4446b79edb905065 against parent379c94d5e7c3bb824baf9b5c3705781904848c36. NO TOOLS. Use supplied exact Git code, not prior reviews. Return PASS or FIX with concise separate Spec/Standards findings; every introduced bug needs exact file/line and realistic input/control flow. No invented other reviewers or claim you ran tests.\n\nApproved bounded identity contract: same-owned known model/provider drift must credit all trustworthy usage in the bounded current read batch before recording failed/stopping; foreign native session/inode/cwd or stale lease receives zero attribution. Failed cursor never revives (exact failed replay idempotent). Missing first or any later identity makes stream coverage incomplete permanently; a later valid model cannot upgrade it. Resumed/repeated baseline of existing owned session cannot borrow prior approval; hydrate prior evidence but downgrade coverage. Predispatch selected model/provider and actual observed native identity stay distinct and honest: Codex native turn-context is execution selection, not provider response identity; Claude message model is response evidence, not transport provider. Do not infer provider from modelname. Exact-session identity capability is eligible only with drained cursor, actual observed identity and complete post-baseline coverage. Manual/legacy usage accounting may proceed without eligible identity. No paid fallback, new launcher/store, auth/trust/config changes or review/merge automatic policy in scope. Spend after failure batch/stop remains potentially unknown.\n\nOwner reports51tests (39engine+9actualPG+3ledger) and core/engine builds pass, not actual native runtime acceptance. Challenge source and coverage, especially atomic ownership and unknown identity cases. Do not demand broader protocols outside this scope. Full production/test changed files and governing/context files follow, with line numbers. Large index barrel is contextual diff only.\n\n'''+diff.decode()
for p in paths:
 if p=='packages/core/src/index.ts':continue
 b=(out/'export'/p).read_text()
 prompt+='\nEXACT HEAD FILE '+p+'\n'+''.join(f'{i}: {line}\n' for i,line in enumerate(b.splitlines(),1))
assert len(prompt.encode())<=400000,len(prompt.encode())
(out/'prompt.txt').write_text(prompt);m['promptBytes']=len(prompt.encode());m['promptSha256']=hashlib.sha256(prompt.encode()).hexdigest();m['diffSha256']=hashlib.sha256(diff).hexdigest()
(out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
print(out,m['promptBytes'],m['promptSha256'])
