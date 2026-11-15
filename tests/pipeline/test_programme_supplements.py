"""Independent PDFMiner source proof; the frozen programme extractor is never imported."""
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
from budget_pipeline.validate.programme_supplements import ROOT,read_sources,projection,accounting,validate_document,valid_supplement,same_cells,registered_notes

class ProgrammeSupplements(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.sources=read_sources()

    def document(self,source):
        template=json.loads((ROOT/'packages/ingest/test/fixtures/wave13b/oracle/ministries/0200.json').read_text())
        agency=next(x for x in json.loads((ROOT/'data/release/ministries.json').read_text())['items'] if x['id']==source['code'])
        ac=accounting(source);total=source['rows'][0]['values'][1];pages=list(dict.fromkeys(row['page'] for row in source['rows']))
        template.update({k:agency[k] for k in ('id','art','name','short','policiesKind')})
        template.update(sourceContract='programme-supplement/1',sourceAudit=dict(sourceSha256=source['sourceSha256'],rows=deepcopy(source['rows'])),**projection(source),accounting=ac,yearsComplete=[2026],tier='source-verified',skipped=[],skippedTotal=0,notes=list(registered_notes(source['code'])),check=dict(prbTotal2026=total,zdbExp=agency['expKhil'],matchesLaw=agency['expKhil']==total,sourceDifferences=len(ac['differences']),unavailableChecks=len(ac['unavailable'])))
        template['doc'].update(file=source['file'],pages=pages,pagesByYear={'2026':pages})
        if source['code']=='7400':template['yearLabels'][3]='Прогноза 2026';template['vintage'][3]='forecast'
        return template

    def test_independent_reference_and_exact_registry_are_fresh(self):
        stored=json.loads((ROOT/'packages/dataset-schema/src/programme-references.json').read_text())
        registry=json.loads((ROOT/'packages/dataset-schema/src/programme-differences.json').read_text())
        self.assertTrue(same_cells(stored,self.sources))
        for code,source in self.sources.items():
            self.assertEqual(registry[source['sourceSha256']]['differences'],accounting(source)['differences'])
            self.assertTrue(validate_document(self.document(source),source))
            self.assertTrue(valid_supplement(self.document(source)))

    def test_rejects_every_changed_decoded_cell_and_blank(self):
        for code,source in self.sources.items():
            for r,row in enumerate(source['rows']):
                for c,old in enumerate(row['values']):
                    doc=self.document(source)
                    doc['sourceAudit']['rows'][r]['values'][c]=0 if old is None else old+1
                    with self.assertRaises(ValueError,msg='%s/%d/%d'%(code,r,c)):validate_document(doc,source)
                    self.assertFalse(valid_supplement(doc))
            doc=self.document(source);doc['sourceAudit']['sourceSha256']='0'*64
            self.assertFalse(valid_supplement(doc))

    def test_rejects_every_changed_projected_cell(self):
        for source in self.sources.values():
            expected=projection(source)
            nodes=[None]+[(i,j) for i,p in enumerate(expected['policies']) for j in [None]+list(range(len(p.get('programs',[]))))]
            for position in nodes:
                for c in range(9):
                    doc=self.document(source)
                    if position is None:values=doc['total']['2026']
                    else:
                        i,j=position;p=doc['policies'][i];values=(p if j is None else p['programs'][j])['values']['2026']
                    old=values[c];values[c]=0 if old is None else old+1
                    with self.assertRaises(ValueError):validate_document(doc,source)

    def test_mutated_pdfminer_token_does_not_validate(self):
        from pdfplumber.utils import extract_text
        changed=[]
        def mutate(chars):
            text=extract_text(chars)
            if text and not changed and __import__('re').fullmatch(r'[\s\d]+[,.]\d',text):
                changed.append(True)
                return __import__('re').sub(r'\d',lambda m:str((int(m[0])+1)%10),text,count=1)
            return text
        with patch('pdfplumber.utils.extract_text',side_effect=mutate):mutated=read_sources()
        self.assertTrue(changed)
        first=next(c for c in self.sources if mutated[c]!=self.sources[c])
        with self.assertRaises(ValueError):validate_document(self.document(self.sources[first]),mutated[first])

    def test_zero_is_not_a_boolean_and_nulls_do_not_drift(self):
        for source in self.sources.values():
            r,c=next((r,c) for r,row in enumerate(source['rows']) for c,value in enumerate(row['values']) if value==0)
            for invalid in (False,True,'0',None):
                doc=self.document(source);doc['sourceAudit']['rows'][r]['values'][c]=invalid
                with self.assertRaises(ValueError):validate_document(doc,source)
            doc=self.document(source);doc['total']['2026'][0]=False
            with self.assertRaises(ValueError):validate_document(doc,source)
        self.assertFalse(same_cells(float('inf'),float('inf')))
        self.assertFalse(same_cells([],{}))

    def test_rejects_unregistered_fields_and_incorrect_envelope(self):
        source=next(iter(self.sources.values()))
        for field in ('meta','art','name','short','policiesKind','years','yearLabels','vintage','cols','doc','notes','skipped','skippedTotal'):
            doc=self.document(source);doc[field]=None
            self.assertFalse(valid_supplement(doc),field)
        for field,value in (('unit','хил. лв.'),('mock',0),('status','pending'),('asOf','invalid'),('retrieved','invalid')):
            doc=self.document(source);doc['meta'][field]=value
            self.assertFalse(valid_supplement(doc),field)
        doc=self.document(source);doc['unregistered']=0
        self.assertFalse(valid_supplement(doc))

    def test_strict_registered_producer(self):
        from budget_pipeline.validate.registry import script
        path='packages/ingest/src/production/programmes.ts'
        self.assertEqual(script(path),path)
        with self.assertRaises(ValueError):script('packages/ingest/src/production/unregistered.ts')

    def test_invalid_contract_and_results(self):
        source=next(iter(self.sources.values()))
        for key in ('id','sourceContract','accounting','tier','yearsComplete','check','total','policies'):
            doc=self.document(source);doc[key]='invalid'
            self.assertFalse(valid_supplement(doc),key)
        self.assertFalse(valid_supplement(None))
        with tempfile.TemporaryDirectory() as root:
            for s in self.sources.values():
                path=Path(root)/'data/originals/program_budgets'/s['file'];path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'%PDF-invalid')
            with self.assertRaisesRegex(ValueError,'pin'):read_sources(root)
