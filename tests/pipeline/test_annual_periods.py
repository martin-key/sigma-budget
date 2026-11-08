"""The active validator must reject mutations, including metadata and sparse coverage."""
import copy
import unittest
import subprocess
import sys
from pathlib import Path
from budget_pipeline.build.annual_periods import Lineage, annual
from budget_pipeline.build.budget_2027 import budget
from budget_pipeline.build.data_io import meta
from budget_pipeline.validate.budget_2027 import g_budget_2027

class Memory:
    def __init__(self, data): self.data=data
    def get(self, path): return self.data[path]

class AnnualPeriodsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        l=Lineage()
        cls.data={k+'.json':{'byPeriod':v} for k,v in annual(l).items()}
        cls.data['budget2027.json']=budget(l)
        cls.data['budget2027-provenance.json']={'documents':l.documents,'entries':l.entries}

    def test_valid_contract(self):
        self.assertEqual(g_budget_2027(Memory(self.data)).problems,[])

    def test_negative_mutations(self):
        for mutation in ('value','unit','period','variant','page','missing-denominator','document','document-hash'):
            with self.subTest(mutation=mutation):
                d=copy.deepcopy(self.data)
                cell=d['outlook.json']['byPeriod']['2027.draft']['series']['revenue']
                if mutation=='value': cell['value']+=1
                if mutation=='unit': cell['unit']='хил. €'
                if mutation=='period': d['outlook.json']['byPeriod']['2027.draft']['periodKey']='2027.law'
                if mutation=='missing-denominator': del d['outlook.json']['byPeriod']['2027.draft']['series']['gdp']
                if mutation=='page': d['budget2027-provenance.json']['entries'][cell['provenance']]['page']+=1
                if mutation=='document': d['budget2027-provenance.json']['entries'][cell['provenance']]['document']='unknown'
                if mutation=='document-hash': d['budget2027-provenance.json']['documents']['forecast']['memberSha256']='0'*64
                if mutation=='variant':
                    next(e for e in d['budget2027-provenance.json']['entries'].values() if e.get('variant')=='bill')['variant']='billMc'
                self.assertTrue(g_budget_2027(Memory(d)).problems)

    def test_legacy_arrays_untouched(self):
        from types import SimpleNamespace
        from budget_pipeline.build.annual_periods import build_annual_periods
        ctx=SimpleNamespace(out={k+'.json':{'years':[2026,2027,2028],'vintage':['plan','forecast','forecast']} for k in ('outlook','revenue','expenditure')})
        before=copy.deepcopy(ctx.out)
        build_annual_periods(ctx)
        for name in before:
            self.assertEqual({k:v for k,v in ctx.out[name].items() if k!='byPeriod'},before[name])

    def test_archive_hash_checks_survive_optimization(self):
        root = Path(__file__).resolve().parents[2]
        script = """
from unittest.mock import patch
from budget_pipeline.build.annual_periods import Lineage
for check in ('archive', 'member'):
    if check == 'archive':
        context = patch('budget_pipeline.build.annual_periods.sha256_file', return_value='wrong')
    else:
        context = patch('budget_pipeline.build.annual_periods.zipfile.ZipFile')
    with context as mock:
        if check == 'member':
            mock.return_value.__enter__.return_value.read.return_value = b'wrong member bytes'
        try:
            Lineage()
        except ValueError as error:
            expected = 'Archive' if check == 'archive' else 'PDF member'
            if expected not in str(error):
                raise
            continue
        raise RuntimeError(check + ' checksum verification was disabled')
"""
        result = subprocess.run([sys.executable, '-O', '-c', script], cwd=root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_provenance_api_response_contract(self):
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(['node', 'tests/release/budget_provenance_check.mjs'], cwd=root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
