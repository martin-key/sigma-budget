"""Fresh actual-source Python 3.12 comparisons. Writes only the exclusive owned output.
Never unpacks, acquires sources, runs an orchestrator or modifies the donor.
"""
import ast, importlib.util, json, os, sys
from pathlib import Path

sys.dont_write_bytecode=True
assert sys.version_info[:2] == (3,12), 'Use Python 3.12'
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve()
assert not out.is_relative_to(root) and not root.is_relative_to(out)
out.mkdir(exist_ok=False)
sys.path.insert(0,str(root/'pipeline'))
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def dump(name,v):
    (out/name).write_text(json.dumps(v,ensure_ascii=False,indent=1)+'\n')

from budget_pipeline.extract import bill, dbp2027
from budget_pipeline.build.data_io import Problems
p=Problems('publication-donor');r=bill.build(p);assert not p.errors,p.errors;dump('legal.json',r)
dbp2027.OUT=out/'dbp.json';dbp2027.main()
path=root/'pipeline/budget_pipeline/extract/program_budgets.py'
tree=ast.parse(path.read_text());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
main.body=[n for n in main.body if not(isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='unpack')]
namespace={'__file__':str(path),'__name__':'publication_donor'};exec(compile(tree,str(path),'exec'),namespace)
namespace['OUT']=str(out/'programmes.json');namespace['main']()
from budget_pipeline.build import program_budget_pdf as pdf
evidence={};rowstreams={}
for f in sorted(pdf.PDF_DIR.glob('*.pdf')):
    rows,pages=pdf.read_rows(f.name);cells,conflicts=pdf.cells_of(rows);pdf.resolve_by_structure(cells)
    evidence[f.name]={'cells':[[list(k),v] for k,v in cells.items()],'conflicts':conflicts,'programNames':pdf.program_names(f.name),'rowLabels':pdf.row_labels(f.name)}
    rowstreams[f.name]={'rows':rows,'pages':pages}
dump('pdf-evidence.json',evidence);dump('pdf-rows.json',rowstreams)
dump('run.json',{'python':sys.version,'donorRoot':str(root),'actualPdfCount':len(evidence),'allDonorChecksPassed':True})
