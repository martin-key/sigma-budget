#!/usr/bin/env python3
"""Execute frozen catalog donors on explicit captured owner streams, offline."""
import argparse, hashlib, json, os, shutil, sys, tempfile
from pathlib import Path
from types import SimpleNamespace
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
BASELINE = '2c26950ab11195c7390580a605ce3c376ddbc116'

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def capture_owners(release, stage, check):
    target=HERE/'final-owners'; actual=set()
    for p in release.rglob('*'):
        if not p.is_file() or p.name=='catalog.json': continue
        rel=p.relative_to(release); baseline=HERE/'owners'/rel
        if not baseline.is_file(): raise ValueError('unexpected owner: '+str(rel))
        changed=p.read_bytes()!=baseline.read_bytes()
        if stage=='stage-owners':
            if changed: raise ValueError('stage stream differs: '+str(rel))
        elif changed:
            actual.add(rel); out=target/rel
            if check:
                if not out.is_file() or out.read_bytes()!=p.read_bytes(): raise ValueError('owner stream differs: '+str(rel))
            else:
                out.parent.mkdir(parents=True,exist_ok=True); out.write_bytes(p.read_bytes())
    if stage=='final-owners' and check:
        existing={p.relative_to(target) for p in target.rglob('*') if p.is_file()}
        if actual != existing: raise ValueError('final owner set differs')

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--check', action='store_true'); args=parser.parse_args()
    if sys.version_info[:2] != (3,12): raise RuntimeError('Python 3.12 required')
    provenance=json.loads((HERE/'provenance.json').read_text())
    if provenance['baseline'] != BASELINE: raise ValueError('wrong baseline')
    for name, sha in provenance['files'].items():
        if digest(HERE/name) != sha: raise ValueError('hash mismatch: '+name)
    os.environ['BUILD_DATE']='2026-11-08'
    sys.path.insert(0, str(HERE/'donor'))
    from budget_pipeline.build import catalog, catalog_definitions, catalog_refresh, data_io, definitions, wording, active_data, apply_sources
    from budget_pipeline.validate.execution_contract import numbers
    from budget_pipeline.routes import load_routes
    authored=json.loads((HERE/'inputs/authored.json').read_text())
    facts=json.loads((HERE/'inputs/file-facts.json').read_text())
    if authored['catalogDefinitions'] != catalog_definitions.DEFS or authored['catalogGroups'] != catalog_definitions.GROUPS: raise ValueError('authored definitions mismatch')
    class CapturedPath:
        def __init__(self, category, path=''): self.category=category; self.path=path
        def __truediv__(self, item): return CapturedPath(self.category, '/'.join(filter(None,(self.path,str(item)))))
        @property
        def name(self): return self.path.rsplit('/',1)[-1]
        def exists(self): return self.path in facts[self.category]
        def stat(self): return SimpleNamespace(st_size=facts[self.category][self.path]['bytes'])
        def read_text(self, encoding='utf-8'):
            if self.category=='raw' and self.path=='MANIFEST.json': return (HERE/'inputs/manifest.json').read_text(encoding=encoding)
            raise ValueError('unavailable bytes: '+self.path)
    def captured_hash(path): return facts[path.category][path.path]['sha256']
    catalog.RAW=CapturedPath('raw'); catalog.CACHE=CapturedPath('cache'); catalog._ASBP_PDF=catalog.RAW/'asbp'/'UMTBF-2026-2028-motivi.pdf'; catalog.sha256_file=captured_hash
    class Context:
        def __init__(self, release):
            self.out={}; self.texts={}; self.notes=[]
            for p in (HERE/'owners').rglob('*.json'):
                name=p.relative_to(HERE/'owners').as_posix()
                if name not in ('glossary.json','guide.json','gva-sectors.json','dbp2027.json'):
                    self.out[name]=json.loads(p.read_text())
            self.texts['feed.xml']=(HERE/'owners/feed.xml').read_text()
            self.execution=numbers(json.loads((HERE/'owners/execution.json').read_text()))
        def get(self,name,default=None): return self.out.get(name,default)
        def put(self,name,obj): self.out[name]=obj; return obj
    definitions.set_kfp_pending(numbers(json.loads((HERE/'owners/execution.json').read_text())))
    if authored['pending'] != definitions.PENDING_DEFS: raise ValueError('pending mismatch')
    with tempfile.TemporaryDirectory(prefix='catalog-oracle-') as tmp:
        root=Path(tmp); release=root/'data/release'; shutil.copytree(HERE/'owners',release)
        (root/'data/inputs').mkdir(parents=True); shutil.copy2(HERE/'inputs/wording.json',root/'data/inputs/wording.json'); shutil.copy2(HERE/'inputs/datasets.yaml',root/'data/datasets.yaml')
        ctx=Context(release); catalog.DATA=release
        cat=catalog.catalog(ctx)
        raw=(data_io.jdumps(cat)+'\n').encode(); (release/'catalog.json').write_bytes(raw)
        # Serialize all ctx.out owner values in the same stage as the production builder.
        for name,obj in ctx.out.items():
            if name!='catalog.json': (release/name).write_text(data_io.jdumps(obj)+'\n',encoding='utf-8')
        (release/'feed.xml').write_text(ctx.texts['feed.xml'],encoding='utf-8')
        capture_owners(release, 'stage-owners', args.check)
        wording.ROOT=root
        for name in ('catalog.json','core.json','search-index.json'):
            sys.argv=['wording',name,'data/release']; wording.main()
        sys.argv=['active_data',str(release),'--apply']; active_data.main()
        apply_sources.W=root; apply_sources.main()
        capture_owners(release, 'final-owners', args.check)
        catalog_refresh.DATA=str(release); catalog_refresh.ROOT=str(root)
        catalog_refresh.active_routes=lambda: {r['id'] for r in load_routes(HERE/'inputs/routes.json')}
        catalog_refresh.page_needs=lambda: {}
        cat=json.loads((release/'catalog.json').read_text()); catalog_refresh.refresh(cat)
        final=json.dumps(cat,ensure_ascii=False,separators=(',',':')).encode()
        expected={'raw.json':raw,'final.json':final}
        for name, data in expected.items():
            path=HERE/'oracle'/name
            if args.check:
                if path.read_bytes()!=data: raise ValueError('oracle differs: '+name)
            else: path.write_bytes(data)
        # Mutants are driven through the same unchanged donor, with their exact
        # serialized owner bytes kept independently for the TypeScript caller.
        for case in ('revenue', 'law', 'int', 'float', 'exp', 'negative0', 'bool', 'yearfloat', 'yearexp'):
            mutant=Context(release)
            if case in ('revenue','yearfloat','yearexp'):
                name='revenue.json'; owner=mutant.out[name]
                if case=='revenue':
                    owner['meta']['status']='mock'; owner['meta']['source']=['kfp','asbp']
                    owner['byPeriod'][next(iter(owner['byPeriod']))]['year']=2033
                    owner['rows'].pop()
                else: owner['years'][0]=float(owner['years'][0])
            else:
                name='law.json'; owner=mutant.out[name]
                changed=next(row for row in owner['budgets'] if row['changed'])
                values={'law':12.0,'int':1,'float':1.0,'exp':1.0,'negative0':-0.0,'bool':True}
                changed['art']=values[case]; owner['totals']['diff']['rev']+=17.5
            stream=(data_io.jdumps(owner)+'\n').encode()
            source=stream
            if case=='exp': source=source.replace(b'\"art\":1.0',b'\"art\":1e0',1)
            if case=='yearexp': source=source.replace(b'\"years\":[2024.0',b'\"years\":[2024e0',1)
            if case=='negative0': source=source.replace(b'\"art\":0.0',b'\"art\":-0.0',1)
            result=(data_io.jdumps(catalog.catalog(mutant))+'\n').encode()
            for rel,data in [('inputs/'+case+'.json',source),('serialized/'+case+'.json',stream),('oracle/'+case+'.json',result)]:
                path=HERE/'cases'/rel
                if args.check:
                    if path.read_bytes()!=data: raise ValueError('mutant differs: '+rel)
                else:
                    path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
        print('catalog donors: checked' if args.check else 'catalog donors: captured', 'notes:', ctx.notes)
if __name__=='__main__': main()
