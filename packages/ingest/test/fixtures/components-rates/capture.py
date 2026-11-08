"""Capture raw-reader evidence from the recorded source files, after verifying hashes.

Manual, offline operation only. Restore the documented archive into a disposable worktree
first. CI regenerates the oracle from the captured evidence, never from live data.
"""
import hashlib,json
from pathlib import Path
from budget_pipeline.build import rates
from budget_pipeline.extract import budget_law_parser as law
from budget_pipeline.validate.execution_contract import numbers
root=Path('.'); dest=root/'packages/ingest/test/fixtures/components-rates/inputs'
expected=json.loads((dest/'capture-source-hashes.json').read_text())
for path, expected_hash in expected.items():
 actual=hashlib.sha256((root/path).read_bytes()).hexdigest()
 if actual != expected_hash:
  raise ValueError(f'source hash mismatch: {path}')
def save(name,value):
 (dest/name).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')
doo=law.dv_blocks(str(rates.DOO_HTML)); nzok=law.dv_blocks(str(rates.NZOK_HTML))
save('doo-blocks.json',doo); save('nzok-blocks.json',nzok)
blocks=law.docx_blocks(str(rates.BILL_DOCX)); tables=[v for k,v in blocks if k=='t' and v and len(v[0])==7 and law.ws(v[0][1]).upper()=='ОСНОВНИ ДОПУСКАНИЯ']
assert len(tables)==1
save('bill-blocks.json',[['t',tables[0]]])
save('nap-rows.json',rates._nap_rows())
save('tables.json',json.loads((root/'data/originals/asbp/asbp_tables.json').read_text())['tables'])
write=lambda name,path: save(name,json.loads(Path(path).read_text()))
write('pages.json','data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json')
for name in ['law','municipalities','outlook']:
 write(name+'.json','data/release/'+name+'.json')
save('execution.json',numbers(json.loads((root/'data/release/execution.json').read_text())))
write('kfp-components.json','data/inputs/kfp_components_2026.json')
print('raw-reader evidence captured from hash-verified sources')
