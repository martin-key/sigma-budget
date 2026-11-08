"""Pinned-PDF integration, parsing and fail-closed mutation tests."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from budget_pipeline.extract import budget_forecast_2027 as extract
MODULE = 'budget_pipeline.extract.budget_forecast_2027'


class ExtractForecast(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.path = Path(cls.temporary.name) / 'first.json'
        result = subprocess.run([__import__('sys').executable, '-m', MODULE, '--output', str(cls.path)], capture_output=True)
        if result.returncode != 0 or not cls.path.exists():
            raise AssertionError(result.stderr.decode())
        cls.bytes = cls.path.read_bytes()
        cls.output = json.loads(cls.bytes)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_reproduce_and_fail_closed_on_source_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'forecast.json'
            result = subprocess.run([__import__('sys').executable, '-m', MODULE, '--output', str(output)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(output.read_bytes(), self.bytes)

    def test_discrepancies_remain_explicit(self):
        self.assertFalse([c for c in self.output['checks'] if not c['passed']])
        self.assertTrue(self.output['diagnostics'])
        self.assertTrue(all(c['pages'] for c in self.output['diagnostics']))

    def test_wrapped_function_number_and_label(self):
        row = self.output['tables']['III_1']['rows'][12]
        self.assertEqual(row['values'][1], 20394.3)
        self.assertEqual(row['printed'][1], '20 394,3')
        self.assertEqual(row['label'], 'Социално осигуряване, подпомагане и грижи')

    def test_mutation_breaks_accounting_and_duplicate_checks(self):
        tables = copy.deepcopy(self.output['tables'])
        tables['II_1']['rows'][0]['values'][2] += 10
        failed = [c['name'] for c in extract.validate(tables) if not c['passed']]
        self.assertIn('II_1 revenue-expenditure 2027', failed)
        self.assertIn('II_1 vs annex3_mln row 0', failed)
        self.assertIn('II_1 sum 0/2', failed)

    def test_known_gdp_exception_is_exact(self):
        tables=copy.deepcopy(self.output['tables'])
        tables['I_2']['rows'][0]['values'][1]+=1
        failures=[c for c in extract.validate(tables) if not c['passed']]
        self.assertTrue(any(c['name']=='GDP I-2 vs Annex3 2025 known discrepancy' for c in failures))

    def test_annex2_dated_rates_and_continuations(self):
        rows=self.output['tables']['annex2']['rows']
        self.assertEqual(len(rows),100)
        liquid=next(r for r in rows if r['label'].startswith('Акциз на течност'))
        self.assertEqual(liquid['printed'][0],'0,25 (от 1 януари 2026 г.) / 0,28 (от 1 август 2026 г.)')
        self.assertEqual(liquid['printed'][1],'0,31 (от 1 март 2027 г.)')
        pension=next(r for r in rows if r['page']==185 and 'професионални пенсионни фондове' in r['label'])
        self.assertIn('7 на сто',pension['printed'][0])
        self.assertEqual(pension['continuation_pages'],[186])
        verification=self.output['cross_representation_checks']
        self.assertEqual(verification['matched'],42)
        self.assertGreaterEqual(verification['annex2_fragment_cells_matched'],400)
        self.assertEqual(verification['mismatches'],0)

    def test_damaged_annex2_cell_fails(self):
        tables=copy.deepcopy(self.output['tables'])
        tables['annex2']['rows'][0]['printed'][0]='21'
        self.assertTrue(any(not c['passed'] and c['name']=='Annex2 fragment alignment 0/0' for c in extract.validate(tables)))

    def test_missing_row_fails(self):
        tables=copy.deepcopy(self.output['tables'])
        tables['annex4']['rows'].pop()
        self.assertTrue(any(not c['passed'] and c['name']=='annex4 shape' for c in extract.validate(tables)))

    def test_all_annex2_semantics_against_source_audit(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/forecast_2027_annex2.json').read_text())
        self.assertEqual(self.output['source']['pdf_sha256'],fixture['source_pdf_sha256'])
        rows=self.output['tables']['annex2']['rows']
        actual=[{k:r[k] for k in fixture['rows'][0]} for r in rows]
        self.assertEqual(actual,fixture['rows'])
        self.assertEqual(len({r['source_id'] for r in rows}),100)
        self.assertEqual(self.output['tables']['annex2']['parse_status'],'checked')

    def test_review_unit_cases(self):
        rows={r['source_id']:r for r in self.output['tables']['annex2']['rows']}
        for sid,unit in [('8.7','евро/1000 къса'),('8.19/item3','евро/kW'),
                         ('8.19/item4','евро/kW'),('10','евро'),('17','евро'),
                         ('8.16/item1','евро/хектолитър на градус Плато')]:
            with self.subTest(source_id=sid):
                self.assertEqual(rows[sid]['units'],[unit]*4)

    def test_subgroups_keep_parent_identity(self):
        rows={r['source_id']:r for r in self.output['tables']['annex2']['rows']}
        for sid,parent,fragment in [('8.3/item1','8.3','LPG'),('8.6/item1','8.6','електрическа'),
                                    ('8.17/item1','8.17','природния'),('8.18/item1','8.18','тежки'),
                                    ('29.1','29','раждане'),('35.1','35','средно'),
                                    ('37.1','37','доброволни'),('38.1','38','професионални')]:
            with self.subTest(source_id=sid):
                context=rows[sid]['parent_context'][-1]
                self.assertEqual(context['source_id'],parent)
                self.assertIn(fragment,context['label'])

    def test_unit_and_parent_mutations_fail(self):
        for mutation in ('unit','parent','heading'):
            tables=copy.deepcopy(self.output['tables'])
            table=tables['annex2']
            row=next(r for r in table['rows'] if r['source_id']=='8.3/item1')
            if mutation=='unit':row['units']=['wrong']*4
            elif mutation=='parent':row['parent_context'][-1]['label']='wrong'
            else:next(h for h in table['headings'] if h['source_id']=='8.3')['label']='wrong'
            self.assertTrue(any(not c['passed'] for c in extract.validate(tables)),mutation)

    def test_complete_source_inventory(self):
        inventory=self.output['inventory']
        self.assertEqual(len(inventory['numbered_tables']),23)
        self.assertEqual(len(inventory['annexes']),10)
        self.assertEqual(self.output['page_text'][-1]['page'],201)
        for key in inventory['numbered_tables']+[a['id'] for a in inventory['annexes'] if int(a['id'][5:])>=5]:
            tables=copy.deepcopy(self.output['tables'])
            self.assertIn(key,tables, f'Missing source table: {key}')
            del tables[key]
            failures=extract.validate_inventory(tables,inventory)
            self.assertTrue(any(not c['passed'] and c['name']=='inventory '+key for c in failures),key)

    def test_all_annex_inventory_entries_are_required(self):
        for annex in self.output['inventory']['annexes']:
            key=annex['id']
            tables={k:v for k,v in self.output['tables'].items() if k!=key and not k.startswith(key+'_')}
            failures=extract.validate_inventory(tables,self.output['inventory'])
            self.assertTrue(any(c['name']=='inventory '+key and not c['passed'] for c in failures),key)

    def test_new_table_column_dimensions_and_units(self):
        tables=self.output['tables']
        self.assertEqual([c['provider'] for c in tables['I_4']['columns']],['МФ','МФ','ЕК','МФ','ЕК'])
        self.assertEqual([c['scope'] for c in tables['IV_1']['columns']],['total','local','delegated','total','total'])
        self.assertEqual([c['measure'] for c in tables['annex7']['columns']],['net','expenditure','transfer']*3)
        self.assertEqual(tables['I_1']['rows'][2]['units'],['щ.д./евро']*6)
        self.assertEqual(tables['II_4']['rows'][2]['units'],['% от БВП']*4)
        self.assertEqual(tables['VII_3']['rows'][1]['units'],['пр.п.']*4)

    def test_new_table_arithmetic_mutation(self):
        for key,row,col in [('II_7',26,0),('II_8',10,0),('annex7',1,3),
                            ('annex8',2,1),('annex9',0,0),('annex10',4,1)]:
            tables=copy.deepcopy(self.output['tables'])
            tables[key]['rows'][row]['values'][col]+=10
            self.assertTrue(any(not c['passed'] for c in extract.validate_remaining(tables)),key)

    def test_scenario_comparison_header(self):
        table=self.output['tables']['II_6']
        self.assertEqual([h['page'] for h in table['scenario_headers']],[43,44])
        for header in table['scenario_headers']:
            self.assertEqual(header['printed'],
                ['Базисен сценарий','Изменение спрямо основния сценарий, %']*4)
        self.assertEqual([c['measure'] for c in table['columns']][1::2],
                         ['difference_from_main_scenario_pct']*4)
        self.assertEqual(table['gdp_share_headers'],{'page':44,'printed':['% от БВП']*4})
        for row in table['rows']:
            if row['label'].startswith(('17.','18.')):
                self.assertEqual(row['measures'],['baseline','gdp_share_pct']*4)
            else:
                self.assertNotIn('measures',row)
        social=next(r for r in table['rows'] if r['label'].startswith('9.'))
        self.assertEqual(social['values'][5],9.2)

    def test_vintages_follow_printed_headers(self):
        tables=self.output['tables']
        self.assertEqual(tables['I_1']['status_headers'][0]['printed'],['Отчетни данни','Прогноза'])
        self.assertEqual([c['vintage'] for c in tables['I_1']['columns']],
                         ['отчет','отчет','прогноза','прогноза','прогноза','прогноза'])
        self.assertEqual(tables['III_2']['status_headers'][0]['printed'],
                         ['Програма','Проект','Прогноза','Прогноза'])
        self.assertEqual([c['vintage'] for c in tables['III_2']['columns']],
                         ['програма','проект','прогноза','прогноза'])
        self.assertEqual([c['vintage'] for c in tables['IV_1']['columns']],
                         ['проект','проект','проект','прогноза','прогноза'])
        for key in ('annex1_execution2025','annex1_execution2026'):
            self.assertEqual(tables[key]['columns'][0]['vintage'],'програма')
            self.assertNotIn('vintage',tables[key]['columns'][-1])
            for header in tables[key]['status_headers']:
                self.assertEqual(header['printed'],['Програма','Отчет','Програма'])

    def test_tables_without_status_headers_have_no_vintages(self):
        for key in ('I_3','I_4','II_4','II_6','II_7','II_8','II_9','V_1','V_2',
                    'VII_1','VII_2','VII_3','annex2','annex4','annex5','annex6',
                    'annex7','annex8','annex9'):
            with self.subTest(table=key):
                table=self.output['tables'][key]
                self.assertTrue(all('vintage' not in c for c in table['columns']))
                self.assertTrue(all(h['printed']==[] for h in table['status_headers']))

    def test_column_metadata_mutations_fail(self):
        for key,mutation in [
            ('I_1',lambda t:t['columns'][2].update(vintage='очаквано')),
            ('III_2',lambda t:t['columns'][0].update(vintage='очаквано')),
            ('I_3',lambda t:t['columns'][0].update(vintage='отчет')),
            ('II_6',lambda t:t['columns'][1].update(measure='annual_change_or_gdp_share')),
            ('II_6',lambda t:t['rows'][-1]['measures'].__setitem__(1,'annual_change')),
            ('III_2',lambda t:t['status_headers'][0]['printed'].__setitem__(0,'Очаквано'))]:
            tables=copy.deepcopy(self.output['tables'])
            mutation(tables[key])
            self.assertTrue(any(not c['passed'] for c in extract.validate_metadata(tables)),key)

    def test_numeric_conversion(self):
        self.assertEqual(extract.number('− 3 492,2'), -3492.2)
        self.assertEqual(extract.number('37,8%'), 37.8)
        self.assertIsNone(extract.number('15 (от 1 януари 2026 г.)'))


if __name__ == '__main__':
    unittest.main()
