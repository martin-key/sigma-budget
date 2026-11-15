import unittest
import json
from pathlib import Path
from copy import deepcopy
from budget_pipeline.validate.debt_issues import valid_debt_issues

class DebtIssuesContract(unittest.TestCase):
    def test_snapshot_and_rejections(self):
        doc=json.loads((Path(__file__).resolve().parents[2]/'data/release/debt-issues.json').read_text())
        self.assertTrue(valid_debt_issues(doc))
        for name in ('meta','schema','sourceSha256','sourceUrl','domestic','external','auctions','maturity','stock','differences','limitations','validation'):
            d=deepcopy(doc);del d[name];self.assertFalse(valid_debt_issues(d),name)
        for change in [lambda d:d['domestic'].pop(),lambda d:d['external'].pop(),lambda d:d['auctions'].pop(),lambda d:d['domestic'][0].update(isin='invalid'),lambda d:d['external'][0].update(isins=[]),lambda d:d['auctions'][0].update(approved=10**15),lambda d:d['maturity'][0].update(originalTenths=0),lambda d:d['external'][0].update(currency='BGN'),lambda d:d['domestic'][0].update(maturity='2000-01-01'),lambda d:d['external'][0].update(nominal=None)]:
            d=deepcopy(doc);change(d);self.assertFalse(valid_debt_issues(d))

    def test_independent_source_cells(self):
        doc=json.loads((Path(__file__).resolve().parents[2]/'data/release/debt-issues.json').read_text())
        for table,field in [('domestic','price'),('auctions','price'),('external','maturity'),('domestic','coupon'),('domestic','nominal'),('domestic','isin'),('auctions','yield')]:
            d=deepcopy(doc); row=d[table][0]; old=row[field]
            row[field]=(old+(1 if field=='nominal' else 0.01) if isinstance(old,(float,int)) else str(int(old[:4])+1)+old[4:] if field=='maturity' else d['domestic'][1]['isin'])
            from budget_pipeline.validate.debt_cells import verify_debt_cells
            self.assertFalse(verify_debt_cells(d),table+'.'+field)
            self.assertFalse(valid_debt_issues(d),table+'.'+field)

    def test_every_extracted_cell_is_bound_to_the_source(self):
        from budget_pipeline.validate.debt_cells import extract,verify_debt_cells,DEFAULT,SOURCE
        doc=json.loads((Path(__file__).resolve().parents[2]/'data/release/debt-issues.json').read_text())
        def leaves(v,path=()):
            if isinstance(v,dict):
                for k,x in v.items(): yield from leaves(x,path+(k,))
            elif isinstance(v,list):
                for k,x in enumerate(v): yield from leaves(x,path+(k,))
            else: yield path,v
        for path,value in leaves(extract(str(DEFAULT),SOURCE)):
            d=deepcopy(doc);row=d
            for key in path[:-1]: row=row[key]
            row[path[-1]]=value+1 if isinstance(value,(int,float)) else value+' changed'
            self.assertFalse(verify_debt_cells(d),str(path))

    def test_typescript_reference_is_fresh_independent_pdf_decoding(self):
        from budget_pipeline.validate.debt_cells import extract,DEFAULT,SOURCE
        root=Path(__file__).resolve().parents[2]
        stored=json.loads((root/'packages/ingest/src/production/debt-cell-reference.json').read_text())
        self.assertEqual(stored,dict(sourceSha256=SOURCE,tables=extract(str(DEFAULT),SOURCE)))
