import json, pathlib, subprocess, sys
receipt=pathlib.Path('/tmp/fusion268-integrated-a2-child-exit.json')
receipt.unlink(missing_ok=True)
outer=subprocess.run(['/Users/man/.hermes/node/bin/node','/Users/man/worktrees/Fusion/300-live-integration/reports/issue-268-projection-branch-review/integration/pg-runner.mjs'])
code=json.loads(receipt.read_text())['code'] if receipt.exists() else (outer.returncode or 1)
print('CHILD_VERDICT_EXIT',code,'OUTER_NODE_EXIT',outer.returncode)
sys.exit(code if isinstance(code,int) else 1)
