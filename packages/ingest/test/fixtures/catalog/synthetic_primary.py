#!/usr/bin/env python3
"""Exercise unchanged primary_files against actual synthetic filesystem bytes."""
import hashlib, json, sys, tempfile
from pathlib import Path
from types import SimpleNamespace
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent/'donor'))
from budget_pipeline.build import catalog

def sha(b): return hashlib.sha256(b).hexdigest()
with tempfile.TemporaryDirectory(prefix='catalog-primary-') as tmp:
 root=Path(tmp); raw=root/'raw'; cache=root/'cache'; raw.mkdir(); cache.mkdir()
 records=[('nap/a.pdf','A',['nap'],['rates']),('dv/b.html','B',['zdb'],['law'])]
 man={}
 facts={}
 for i,(key,*_) in enumerate(records):
  data=('synthetic %d'%i).encode(); url='https://example.invalid/%D0%B0%20'+str(i)+'.pdf?q=x'
  man[key]={'url':url,'http_status':200,'sha256':sha(data),'bytes':len(data),'retrieved':'2026-11-08T10:00:00'}
  if i==0:
   path=raw/key; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data); facts[key]={'bytes':len(data)}
 (raw/'MANIFEST.json').write_text(json.dumps(man))
 pdf=raw/'asbp/UMTBF-2026-2028-motivi.pdf'; pdf.parent.mkdir(); pdf.write_bytes(b'synthetic pdf'); facts['asbp/'+pdf.name]={'bytes':pdf.stat().st_size,'sha256':sha(pdf.read_bytes())}
 cachefile=cache/'sample.xlsx'; cachefile.write_bytes(b'synthetic cache'); cachefacts={cachefile.name:{'bytes':cachefile.stat().st_size,'sha256':sha(cachefile.read_bytes())}}
 kfp=raw/'kfp_2026/month.xls'; kfp.parent.mkdir(); kfp.write_bytes(b'synthetic xls'); facts['kfp_2026/month.xls']={'bytes':kfp.stat().st_size}
 execution={'data':{'2026':{'files':[{'file':'month.xls','month':1,'sha256':sha(kfp.read_bytes())},{'file':'absent.xls','month':2,'sha256':sha(b'absent')} ]}}}
 catalog.RAW=raw; catalog.CACHE=cache; catalog._ASBP_PDF=pdf; catalog._MANIFEST_FILES=records; catalog._SEBRA_CACHE=[('sample.xlsx','a%20b.xlsx','01.01.2026')]; catalog._SEBRA_BASE='https://example.invalid/'; catalog.GVA_FILES=[]; catalog.SOURCE_REGISTRY={'kfp':{'url':'https://example.invalid/kfp'}}
 output=catalog.primary_files(SimpleNamespace(execution=execution))
 x={'manifest':man,'manifestFiles':records,'rawFacts':facts,'cacheFacts':cachefacts,'sebraBase':catalog._SEBRA_BASE,'sebraCache':catalog._SEBRA_CACHE,'historicalGva':[],'kfpPage':catalog.SOURCE_REGISTRY['kfp']['url'],'execution':execution,'expected':output}
 print(json.dumps(x,ensure_ascii=False))
