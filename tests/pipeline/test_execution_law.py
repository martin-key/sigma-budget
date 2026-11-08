import copy
import unittest
from unittest.mock import patch
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

    def test_printed_percent_availability(self):
        ex = load(DATA / 'execution.json')
        out = jload(DATA / 'outlook.json')
        forecast = jload(DATA.parent / 'inputs' / 'budget_forecast_2027.json')
        for row in (*range(13), 14, 15, 13, 16, 17):
            with self.subTest(row=row):
                mutated = copy.deepcopy(forecast)
                cells = mutated['tables']['annex1_execution2026']['rows'][row]['values']
                cells[4] = None if row in (*range(13), 14, 15) else 1
                c = Check('LAW')
                with patch('budget_pipeline.build.data_io.jload', return_value=mutated):
                    validate_law(c, ex, out)
                self.assertTrue(c.problems)

    def test_feed_denominator(self):
        from types import SimpleNamespace
        from budget_pipeline.build.feed import _report_events, _highlights, _sentences
        ctx = SimpleNamespace(execution=load(DATA / 'execution.json'))
        h = _highlights(ctx)
        basis = h['planBasis']
        self.assertEqual(basis, {'periodKey': '2026.law', 'basis': 'adopted-law',
            'source': ['budget2027'], 'citation': 'Програма по ЗДБРБ 2026, МФ, приложение 1'})
        events = _report_events(ctx)
        self.assertEqual(events[-1]['planBasis'], basis)
        self.assertEqual(events[-1]['source'], ['kfp', 'budget2027'])
        self.assertIn(basis['citation'], events[-1]['text'])
        self.assertIn(basis['citation'], _sentences(h)[3])
        self.assertTrue(all('planBasis' not in e and e['source'] == ['kfp'] for e in events[:-1]))
