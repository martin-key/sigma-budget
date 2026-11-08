import copy
import unittest
from budget_pipeline.validate.execution_reports import validate_law
from budget_pipeline.validate.checks import Check
from budget_pipeline.validate.execution_contract import load
from budget_pipeline.build.data_io import DATA, jload

class ExecutionLawTest(unittest.TestCase):
    def test_active_law_validator(self):
        ex = load(DATA / 'execution.json')
        out = jload(DATA / 'outlook.json')
        for mutation in (None, 'denominator', 'missing-row', 'percent', 'period', 'basis'):
            with self.subTest(mutation=mutation):
                d = copy.deepcopy(ex)
                if mutation == 'denominator': d['plan2026']['kfp']['rev'] += 1
                if mutation == 'missing-row': d['plan2026']['kfp']['exp.personnel'] = 1
                if mutation == 'percent': d['latest']['kfp']['rev']['pctPlan'] += 1
                if mutation == 'period': d['plan2026']['periodKey'] = '2026.expected'
                if mutation == 'basis': d['plan2026']['basis'] = 'draft'
                c = Check('LAW')
                validate_law(c, d, out)
                self.assertEqual(bool(c.problems), mutation is not None, c.problems)
