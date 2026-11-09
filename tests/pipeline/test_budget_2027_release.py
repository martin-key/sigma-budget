"""Independent selected printed rows read directly from the pinned ZIP PDFs."""
import hashlib
import json
from pathlib import Path
import re
import unittest
import zipfile
import fitz
from budget_pipeline.build.annual_periods import Lineage, annual, pointer
from budget_pipeline.build.budget_2027 import budget, tables
from budget_pipeline.validate.annual_oracles import check_output_oracles
from budget_pipeline.validate.checks import Check

class PdfOraclesTest(unittest.TestCase):
    def test_selected_pdf_cells(self):
        l = Lineage()
        data = {k+'.json': {'byPeriod':v} for k,v in annual(l).items()}
        data['budget2027.json'] = budget(l)
        data['budget2027-tables.json'] = tables(l)
        data['budget2027-provenance.json'] = {'documents':l.documents, 'entries':l.entries}
        ctx = type('Memory', (), {'get':lambda self,name:data[name]})()
        check = Check('PDF_OUTPUTS')
        check_output_oracles(check, ctx)
        self.assertEqual(check.problems, [])

    def test_exact_forecast_row_oracles(self):
        fixtures=json.loads((Path(__file__).parent/'fixtures/budget_2027_pdf_cells.json').read_text())
        l=Lineage()
        mappings={(174,'ПРИХОДИ, ПОМОЩИ'):('annex1_execution2026',0),
                  (174,'РАЗХОДИ И ВНОСКА'):('annex1_execution2026',8),
                  (174,'Капиталови'):('annex1_execution2026',11),
                  (191,'Приходи, помощи'):('annex3_mln',0),
                  (191,'ДДС'):('annex3_mln',11),
                  (42,'21. Консолидиран'):('II_5',24),
                  (192,'Бюджетно салдо'):('annex3_mln',61),
                  (73,'Образование'):('III_1',10),
                  (150,'Държавен дълг'):('VI_1',0)}
        for oracle in fixtures:
            key=(oracle['page'],oracle['label'])
            if key not in mappings: continue
            table,row=mappings[key]
            printed=[float(x.replace(' ','').replace(',','.')) for x in re.findall(r'-?\d[\d ]*,\d+',oracle['printed'])]
            with self.subTest(table=table,row=row):
                self.assertEqual(l.inputs['F']['tables'][table]['rows'][row]['values'],printed)

    def test_macro_gdp_integer_oracle(self):
        fixtures=json.loads((Path(__file__).parent/'fixtures/budget_2027_pdf_cells.json').read_text())
        oracle=next(q for q in fixtures if q['page']==27)
        columns=re.split(r'\s{2,}',oracle['printed'])[1:]
        expected=[float(q.replace(' ','')) for q in columns]
        self.assertEqual(Lineage().inputs['F']['tables']['I_2']['rows'][0]['values'],expected)

    def test_exact_bill_row_oracles(self):
        fixtures=json.loads((Path(__file__).parent/'fixtures/budget_2027_pdf_cells.json').read_text())
        b=Lineage().inputs['B']
        mappings={(1,'ПРИХОДИ, ПОМОЩИ'):('/bill/1/headline/rev',1),
                  (6,'РАЗХОДИ'):('/bill/2/headline/exp',1),
                  (9,'II.      РАЗХОДИ'):('/billMc/2/headline/exp',1),
                  (79,'Банско'):('/municipal/art52/rows/0/values',5),
                  (89,'ВСИЧКО'):('/municipal/art52/total',5),
                  (126,'NP-25.001-0001'):('/projects/rows/0/values',3),
                  (159,'NP-25.003-0142'):('/projects/rows/225/values',3)}
        capital=next(i for i,r in enumerate(b['municipal']['art52']['rows']) if r['name']=='СТОЛИЧНА ОБЩИНА')
        mappings[(87,'СТОЛИЧНА ОБЩИНА')]=(f'/municipal/art52/rows/{capital}/values',5)
        for oracle in fixtures:
            if not oracle['member'].endswith('/3-PZDBRB-2027.pdf'): continue
            key=(oracle['page'],oracle['label'])
            if key not in mappings: continue
            path,count=mappings[key]
            expected=[float(x.replace(' ','').replace(',','.')) for x in re.findall(r'-?\d[\d ]*,\d+',oracle['printed'].split(oracle['label'],1)[-1])][:count]
            actual=pointer(b,path)
            with self.subTest(path=path):
                self.assertEqual(actual if isinstance(actual,list) else [actual],expected)
