"""Additional independent cases using the pinned donor and original harness."""
import hashlib, json, runpy, shutil, sys, tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
if '--verify-extra' in sys.argv:
    meta=json.loads((HERE/'extra-provenance.json').read_text())
    for key,name in [('cases','extra-cases.json'),('generator','generate-extra.py'),('helperCases','extra-helper-cases.json')]:
        if hashlib.sha256((HERE/name).read_bytes()).hexdigest()!=meta[key]:raise SystemExit('changed '+name)
sys.argv.append('--check')
h=runpy.run_path(str(HERE/'generate.py'))
cases=json.loads((HERE/'extra-cases.json').read_text())
out={}
with tempfile.TemporaryDirectory() as temp:
    for case in cases:
        root=Path(temp)/str(len(out));shutil.copytree(HERE/'corpus',root)
        for op in case['ops']:
            if op['op']=='root':
                path=root/'data/release'/op['file'];path.write_text(json.dumps(op['value'],ensure_ascii=False),encoding='utf8')
            elif op['op']=='bytes':
                path=root/'data/release'/op['file'];path.write_bytes(path.read_bytes()+bytes(op['append']))
            else: h['apply'](root,[op])
        out[case['name']]={'raw':h['run'](root,False),'default':h['run'](root,True),'noAccepted':h['run'](root,False)}
encoded=(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n').encode()
path=HERE/'extra-oracle.json'
if '--verify-extra' in sys.argv:
    meta=json.loads((HERE/'extra-provenance.json').read_text())
    for key,name in [('cases','extra-cases.json'),('generator','generate-extra.py')]:
        if hashlib.sha256((HERE/name).read_bytes()).hexdigest()!=meta[key]:raise SystemExit('changed '+name)
    if path.read_bytes()!=encoded or hashlib.sha256(encoded).hexdigest()!=meta['oracle']:raise SystemExit('additional oracle differs')
else:path.write_bytes(encoded)
helpers=json.loads((HERE/'extra-helper-cases.json').read_text())
helper_results=[]
for case in helpers:
    item={}
    for name,fn in [('money',h['search_feed'].money_in),('eur',h['search_feed'].eur_in),('pct',h['search_feed'].pct_in)]:
        try:item[name]=fn(case['text'])
        except Exception as e:item[name]={'crash':type(e).__name__+': '+str(e)}
    c=h['checks'].Check('AMOUNTS')
    try:
        h['search_feed'].amounts(c,'amount',case['text'],money=case['money'],eur=case['eur'],pct=case['pct'])
        item['amounts']=h['capture'](c)
    except Exception as e:item['amounts']={'crash':type(e).__name__+': '+str(e)}
    helper_results.append(item)
helper_bytes=(json.dumps(helper_results,ensure_ascii=False,separators=(',',':'))+'\n').encode()
helper_path=HERE/'extra-helpers-oracle.json'
if '--verify-extra' in sys.argv:
    if hashlib.sha256((HERE/'extra-helper-cases.json').read_bytes()).hexdigest()!=meta['helperCases'] or helper_path.read_bytes()!=helper_bytes or hashlib.sha256(helper_bytes).hexdigest()!=meta['helperOracle']:
        raise SystemExit('additional helper oracle differs')
else:helper_path.write_bytes(helper_bytes)
