"""Capture iterable-boundary outcomes from the unchanged, byte-pinned Python donor."""
import hashlib, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path
if sys.version_info[:2] != (3,12): raise SystemExit('Python 3.12 required')
HERE=Path(__file__).resolve().parent
LEGACY=HERE.parent
cases=json.loads((HERE/'cases.json').read_text(encoding='utf8'))
groups=('ANNEX3','REVENUE','EXPENDITURE','MEASURES','LAW','BUDGETS','PROGRAMS')
def namespace():
    path=LEGACY/'generate_oracle.py'
    ns={'__file__':str(path),'__name__':'iterable_donor'}
    exec(compile(path.read_text().split('\ncases = json.loads')[0],str(path),'exec'),ns)
    return ns
def capture():
    ns=namespace(); out={}
    with tempfile.TemporaryDirectory(prefix='sigma-iterable-donor-') as tmp:
        for c in cases:
            root=Path(tmp)/c['name']; shutil.copytree(LEGACY/'corpus',root)
            for op in c['ops']:ns['mutate'](root,op)
            names=groups if c['full'] else (c['group'],)
            out[c['name']]={g:ns['result'](g,root) for g in names}
            shutil.rmtree(root)
    return out
if '--capture' in sys.argv:
    print(json.dumps(capture(),ensure_ascii=False,separators=(',',':')));raise SystemExit
seeds=list(range(8)); observations={}
for seed in seeds:
    env={**os.environ,'PYTHONHASHSEED':str(seed),'PYTHONDONTWRITEBYTECODE':'1'}
    p=subprocess.run([sys.executable,str(HERE/'generate_oracle.py'),'--capture'],env=env,check=True,capture_output=True,text=True)
    for name, result in json.loads(p.stdout).items():
        variants=observations.setdefault(name,[])
        existing=next((x for x in variants if x['result']==result),None)
        if existing is None: variants.append({'seeds':[seed],'result':result})
        else: existing['seeds'].append(seed)
outputs={}
with tempfile.TemporaryDirectory(prefix='sigma-iterable-preimage-') as tmp:
    ns=namespace()
    for c in cases:
        root=Path(tmp)/c['name'];shutil.copytree(LEGACY/'corpus',root)
        for op in c['ops']:ns['mutate'](root,op)
        for f in sorted({op['file'] for op in c['ops']}): outputs['mutations/'+c['name']+'/'+f]=(root/'data/release'/f).read_bytes()
        shutil.rmtree(root)
outputs['oracle.json']=(json.dumps(observations,ensure_ascii=False,separators=(',',':'))+'\n').encode()
inputs={name:(HERE/name).read_bytes() for name in ('cases.json','generate_oracle.py')}
for name in ('generate_oracle.py','provenance.json','cases.json','oracle.json','sum-cases.json','sum-oracle.json','compound/provenance.json','native/provenance.json'):
    inputs['../'+name]=(LEGACY/name).read_bytes()
proof={'python':'3.12','hashSeeds':seeds,'inputs':{name:hashlib.sha256(data).hexdigest() for name,data in inputs.items()},'outputs':{name:hashlib.sha256(data).hexdigest() for name,data in outputs.items()}}
outputs['provenance.json']=(json.dumps(proof,indent=2)+'\n').encode()
if '--check' in sys.argv:
    expected={k for k in outputs if k.startswith('mutations/')}
    actual={str(p.relative_to(HERE)) for p in (HERE/'mutations').rglob('*') if p.is_file()}
    if actual!=expected:raise SystemExit('Iterable mutation file set differs')
for name,data in outputs.items():
    path=HERE/name
    if '--check' in sys.argv:
        if not path.exists() or path.read_bytes()!=data:raise SystemExit('Iterable donor proof differs: '+name)
    else:
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
