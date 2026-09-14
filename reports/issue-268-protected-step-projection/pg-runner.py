import json, pathlib, subprocess, sys
receipt=pathlib.Path('/tmp/fusion268-protected-step-child-exit.json')
receipt.unlink(missing_ok=True)
outer=subprocess.run(['/Users/man/.hermes/node/bin/node','/tmp/fusion268-protected-step-run.mjs'])
code=json.loads(receipt.read_text())['code'] if receipt.exists() else (outer.returncode or 1)
print('CHILD_VERDICT_EXIT',code,'OUTER_NODE_EXIT',outer.returncode)
sys.exit(code if isinstance(code,int) else 1)
