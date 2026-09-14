import pathlib, subprocess, json, sys
p=pathlib.Path('/tmp/303-identity-integrated-child-exit.json')
p.unlink(missing_ok=True)
r=subprocess.run(['node','reports/issue-303-native-identity/integration/pg-run.mjs'])
code=json.loads(p.read_text())['code'] if p.exists() else (r.returncode or 1)
print('CHILD_VERDICT_EXIT',code,'OUTER_NODE_EXIT',r.returncode)
sys.exit(code if isinstance(code,int) else 1)
