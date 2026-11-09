"""Run the unchanged Python 027 graph against frozen raw-reader evidence only."""
import hashlib
import json
import os
import shutil
import socket
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

if sys.version_info[:2] != (3, 12): raise SystemExit('Python 3.12 required')
if sys.argv[1:] != ['--check']: raise SystemExit('usage: generate_oracle.py --check')
HERE = Path(__file__).resolve().parent
FIX = HERE.parent
os.environ['BUILD_DATE'] = '2026-11-08'
os.environ.pop('BNS_SITE_URL', None)
proof = json.loads((HERE/'proof.json').read_text())
for name, expected in proof['files'].items():
    if hashlib.sha256((HERE/name).read_bytes()).hexdigest() != expected:
        raise ValueError('proof hash mismatch: '+name)
sys.path.insert(0, str(HERE/'donor'))
from budget_pipeline.build import (data_io, context, forecast_tables, fiscal, annual_periods, budget_2027,
    measures, budgets, program_budgets, debt, rates, indirect_taxes, municipalities, law, components,
    payments, feed, core, search, catalog, definitions, guide, frozen_editorial, budget_plan,
    wording, active_data, apply_sources, catalog_refresh)
from budget_pipeline.extract import budget_law_parser
from budget_pipeline.validate.execution_contract import numbers
from budget_pipeline.routes import load_routes
socket.socket = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('network denied'))

def read(name): return json.loads((FIX/name).read_text(encoding='utf8'))
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
inventory = read('wave13b/provenance.json')
for name, expected in inventory['files'].items():
    if digest(FIX/name) != expected: raise ValueError('input hash mismatch: '+name)

fiscal_root = FIX/'fiscal/inputs'
forecast_tables.RAW = fiscal_root/'data/originals'
context.RAW = fiscal_root/'data/originals'
context.SRC = fiscal_root/'data/inputs'
context.PDF_PAGES = fiscal_root/'data/cache/research/mf-umtbf-2026-2028/extracts/pdf_pages_clean.json'
annual_periods.ROOT = fiscal_root
annual_periods.SRC = fiscal_root/'data/inputs'
legal = read('wave13b/legal-evidence.json')
tax = read('indirect-taxes/reader-ir.json')
capture = read('debt-local/inputs/reader-captures.json')
pdfs = read('programmes/inputs/pdf-evidence.json')
doo = read('components-rates/inputs/doo-blocks.json')
nzok = read('components-rates/inputs/nzok-blocks.json')
bill = read('components-rates/inputs/bill-blocks.json')
nap = read('components-rates/inputs/nap-rows.json')

pdf = program_budgets.pdf
pdf.read_rows = lambda filename: (filename, [])
pdf.cells_of = lambda filename: ({tuple(k): v for k, v in pdfs[filename]['cells']}, [tuple(k) for k in pdfs[filename]['conflicts']])
pdf.resolve_by_structure = lambda cells: None
pdf.program_names = lambda filename: pdfs[filename]['programNames']
pdf.row_labels = lambda filename: pdfs[filename]['rowLabels']
by_filename = {filename: legal['dvBlocks'][key] for key, (_, filename, _, _) in law.LAWS.items()}
def blocks(path):
    name = Path(path).name
    if name in by_filename: return by_filename[name]
    if 'zbdoo' in name or 'doo-blocks' in name: return doo
    if 'zbnzok' in name or 'nzok-blocks' in name: return nzok
    raise ValueError('unknown DV reader: '+name)
budget_law_parser.dv_blocks = blocks
budget_law_parser.docx_blocks = lambda path: bill
rates._nap_rows = lambda: nap
rates.NAP_PDF = FIX/'components-rates/inputs/nap-rows.json'
rates.DOO_HTML = FIX/'components-rates/inputs/doo-blocks.json'
rates.NZOK_HTML = FIX/'components-rates/inputs/nzok-blocks.json'
rates.BILL_DOCX = FIX/'components-rates/inputs/bill-blocks.json'
debt._bnb = lambda rel, indicator: capture['bnbGg' if rel == debt.BNB_GG[0] else 'bnbCg']
payments.parse_listing = lambda: json.loads(json.dumps(capture['listing']))
class PaymentFile:
    def __init__(self, day): self.day = day; self.name = day
    def exists(self): return True
    def stat(self): return SimpleNamespace(st_size=capture['files'][self.day]['bytes'])
payments.FILES = {day: PaymentFile(day) for day in capture['files']}
payments.xlsx_rows = lambda path: capture['files'][path.day]['rows']

class FakePath:
    def __init__(self, path=''): self.path = path
    def __truediv__(self, name): return FakePath(self.path+'/'+name)
    @property
    def name(self): return self.path.rsplit('/',1)[-1]
    def read_text(self): return ''
class Text:
    def __init__(self): self.parts = tax['gazetteParts']
    def feed(self, _): pass
class Pdf:
    def __init__(self,pages): self.pages=pages
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def __iter__(self): return iter(SimpleNamespace(get_text=lambda text=text:text) for text in self.pages)
indirect_taxes.RAW = FakePath()
indirect_taxes.Text = Text
indirect_taxes.sheet = lambda path, title: tax[{'Sheet1':'prices','Excise duties':'duties','VAT':'vat'}[title]]
indirect_taxes.fitz = SimpleNamespace(open=lambda path: Pdf(tax['nsiPages'] if 'nsi-pack' in path.path else tax['customsPages']))
indirect_taxes.Document = lambda _: SimpleNamespace(tables=[SimpleNamespace(rows=[SimpleNamespace(cells=[SimpleNamespace(text=c) for c in row]) for row in table]) for table in tax['docxTables']])

sources = {
    'program_budgets_2026': 'programmes/inputs/program-budgets.json',
    'debt_stock': 'debt-local/inputs/data/inputs/debt_stock.json',
    'debt_gdp': 'debt-local/inputs/data/inputs/debt_gdp.json',
    'municipal_transfers_2026': 'debt-local/inputs/data/inputs/municipal_transfers_2026.json',
    'kfp_components_2026': 'components-rates/inputs/kfp-components.json',
    'glossary': 'aggregation/inputs/glossary.json',
}
cache = {'gisco_lau_bg.json': 'debt-local/inputs/data/cache/gisco_lau_bg.json',
         'eurostat_pop_nuts3_bg.json': 'debt-local/inputs/data/cache/eurostat_pop_nuts3_bg.json'}
raws = {'eurostat/gov_10dd_edpt1_BG_EU.json': 'debt-local/inputs/data/originals/eurostat/gov_10dd_edpt1_BG_EU.json',
        'eurostat/gov_10q_ggdebt_BG.json': 'debt-local/inputs/data/originals/eurostat/gov_10q_ggdebt_BG.json',
        'eurostat/tps00001_BG.json': 'aggregation/archive/originals/eurostat/tps00001_BG.json'}
by_id = {str(bid): legal['parliament'][key] for key,(bid,*_) in law.LAWS.items()}
class Context(context.Ctx):
    @property
    def execution(self): return self._get('execution', lambda: numbers(read('aggregation/upstream/execution.json')))
    @property
    def law(self): return self._get('law', lambda: read('programmes/inputs/law-cache.json'))
    def src(self,name): return self._get('src:'+name, lambda: read(sources[name]) if name in sources else read('fiscal/inputs/data/inputs/'+name+'.json'))
    def raw(self,name):
        if name.startswith('parliament/bill_'): return by_id[Path(name).stem.removeprefix('bill_')]
        return self._get('raw:'+name, lambda: read(raws[name]))
    def cache(self,name): return self._get('cache:'+name, lambda: read(cache[name]))
    def cache_exists(self,name): return name in cache

facts = read('catalog/inputs/file-facts.json')
class CapturedPath:
    def __init__(self, category, path=''): self.category=category; self.path=path
    def __truediv__(self, item): return CapturedPath(self.category, '/'.join(filter(None,(self.path,str(item)))))
    @property
    def name(self): return self.path.rsplit('/',1)[-1]
    def exists(self): return self.path in facts[self.category]
    def stat(self): return SimpleNamespace(st_size=facts[self.category][self.path]['bytes'])
    def read_text(self, encoding='utf-8'):
        if self.category=='raw' and self.path=='MANIFEST.json': return (FIX/'catalog/inputs/manifest.json').read_text(encoding=encoding)
        raise ValueError('unavailable bytes: '+self.path)
catalog.RAW=CapturedPath('raw'); catalog.CACHE=CapturedPath('cache')
catalog._ASBP_PDF=catalog.RAW/'asbp'/'UMTBF-2026-2028-motivi.pdf'
catalog.sha256_file=lambda path: facts[path.category][path.path]['sha256']
law.RAW=FIX/'law/inputs/absent-originals'

with tempfile.TemporaryDirectory(prefix='wave13b-oracle-') as tmp:
    root=Path(tmp); release=root/'data/release'; release.mkdir(parents=True)
    editorial_dir=root/'data/inputs/editorial'; editorial_dir.mkdir(parents=True)
    for name in ('glossary.json','guide.json'):
        shutil.copyfile(FIX/'editorial/inputs'/name, editorial_dir/name)
    frozen_editorial.ROOT=root; frozen_editorial.main()
    guide.GUIDE=release/'guide.json'; guide.load_routes=lambda: load_routes(FIX/'catalog/inputs/routes.json')
    sys.argv=['guide','--align-links']
    try: guide.main()
    except SystemExit as exc:
        if exc.code: raise
    budget_plan.W=root; budget_plan.SRC=FIX/'dbp-gva/inputs/figures.json'; budget_plan.PDF=FIX/'dbp-gva/inputs/plan.pdf'; budget_plan.OUT=release/'dbp2027.json'; budget_plan.main()
    for dest, src in [('execution.json','aggregation/upstream/execution.json'), ('execution-provenance.json','aggregation/upstream/execution-provenance.json'), ('gva-sectors.json','aggregation/upstream/gva-sectors.json'), ('releases/current.json','wave13b/releases-current.json')]:
        target=release/dest; target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(FIX/src,target)
    ctx=Context(); definitions.set_kfp_pending(ctx.execution)
    core.DATA=release; search.DATA=release; catalog.DATA=release
    for fn in (fiscal.build_outlook, fiscal.build_revenue, fiscal.build_expenditure, annual_periods.build_annual_periods, budget_2027.build_budget_2027, measures.build_measures, budgets.build_budgets, debt.build_debt, rates.build_rates, indirect_taxes.build_indirect_taxes, municipalities.build_municipalities, law.build_law, components.build_components, payments.build_sebra, feed.build_feed, core.build_core, search.search, catalog.catalog):
        fn(ctx)
    for name,obj in ctx.out.items():
        target=release/name; target.parent.mkdir(parents=True,exist_ok=True); target.write_text(data_io.jdumps(obj)+'\n',encoding='utf8')
    for name,text in ctx.texts.items(): (release/name).write_text(text,encoding='utf8')
    (root/'data/inputs').mkdir(parents=True,exist_ok=True)
    shutil.copyfile(FIX/'aggregation/inputs/wording.json', root/'data/inputs/wording.json')
    shutil.copyfile(FIX/'catalog/inputs/datasets.yaml', root/'data/datasets.yaml')
    wording.ROOT=root
    for name in ('catalog.json','core.json','search-index.json'):
        sys.argv=['wording',name,'data/release']; wording.main()
    sys.argv=['active_data',str(release),'--apply']; active_data.main()
    apply_sources.W=root; apply_sources.main()
    catalog_refresh.DATA=str(release); catalog_refresh.ROOT=str(root)
    catalog_refresh.active_routes=lambda: {r['id'] for r in load_routes(FIX/'catalog/inputs/routes.json')}
    catalog_refresh.page_needs=lambda: {}
    cat=json.loads((release/'catalog.json').read_text()); catalog_refresh.refresh(cat)
    (release/'catalog.json').write_text(json.dumps(cat,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    actual={p.relative_to(release).as_posix():p.read_bytes() for p in release.rglob('*') if p.is_file()}
    target=HERE/'oracle'
    existing={p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file()}
    if existing != set(actual): raise ValueError('oracle inventory differs')
    for name,data in actual.items():
        if (target/name).read_bytes()!=data: raise ValueError('oracle differs: '+name)
    mutant_root=root/'glossary-mutant'; mutant_data=mutant_root/'data/release'; mutant_data.mkdir(parents=True)
    glossary=read('editorial/inputs/glossary.json')
    glossary['terms']=glossary['terms'][:64]
    glossary['categories']=[row for row in glossary['categories'] if row['id']!='byudzhet-2027']
    (mutant_data/'glossary.json').write_text(json.dumps(glossary,ensure_ascii=False),encoding='utf8')
    for name in ('core.json','search-index.json'): shutil.copyfile(release/name,mutant_data/name)
    apply_sources.W=mutant_root; apply_sources.main()
    if (mutant_data/'glossary.json').read_bytes() != (HERE/'mutants/glossary-glue.json').read_bytes():
        raise ValueError('glossary source-glue mutant differs')
    print('wave13b independent Python graph:', len(actual), 'files checked')
