#!/usr/bin/env python3
"""Capture the actual donor base and production wrapper's SEARCH selection."""
import json, os, re, subprocess, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE/'corpus'
env=dict(os.environ, PYTHONPATH=str(ROOT/'pipeline'), BUDGET_DATA_DIR=str(ROOT/'data/release'), BUILD_DATE='2026-11-08', PYTHONDONTWRITEBYTECODE='1')
results={}
for name,module,extra in [('base','base',[]),('default','datasets',[]),('no-accepted','datasets',['--no-accepted'])]:
    proc=subprocess.run([sys.executable,'-m','budget_pipeline.validate.'+module,'--only','SEARCH','-v',*extra],cwd=ROOT,env=env,capture_output=True,text=True,check=False)
    results[name]={'exit':proc.returncode,'stdout':re.sub(r'\d+\.\d s', '<elapsed> s',proc.stdout),'stderr':proc.stderr}
text=json.dumps(results,ensure_ascii=False,indent=2)+'\n'
target=HERE/'wrapper.json'
if '--check' in sys.argv:
    if target.read_text(encoding='utf8')!=text: raise SystemExit('production wrapper evidence differs')
else: target.write_text(text,encoding='utf8')
print('Verified SEARCH base/default/no-accepted wrapper results')
