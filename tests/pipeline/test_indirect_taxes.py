"""Regressions from the independent M06/M07 review; source parsing and active checks."""
import copy
import datetime
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from budget_pipeline.build import indirect_taxes as producer
from budget_pipeline.extract import indirect_tax_evidence as evidence
from budget_pipeline.validate import indirect_taxes as validator

ROOT = Path(__file__).resolve().parents[2]


class EvidenceParsingTest(unittest.TestCase):
    def tables(self):
        serial = str((datetime.date(2026, 11, 2)-datetime.date(1899, 12, 30)).days)
        petrol, diesel = 'Euro-super 95  (I)', 'Gas oil automobile Automotive gas oil Dieselkraftstoff (I)'
        prices = dict(A1='in EUR', A2=serial, A5='Bulgaria', B1=petrol, C1=diesel, B2='1000 l', C2='1000 l', B5='1604.5', C5='1892.7')
        taxes = dict(A7='BG_', C3=petrol, D3=diesel, C4='1000 l', D4='1000 l', B7=str((datetime.date(2026,1,1)-datetime.date(1899,12,30)).days), C7='363.02', D7='330.29', C1='Excises - in national currency per unit (L or t)')
        vat = dict(taxes, C1='VAT (Value added tax), %', C7='20', D7='20')
        return prices, taxes, vat

    def test_product_headers_and_values_cannot_be_swapped(self):
        for target, headers, values in [(0, ('B1','C1'), ('B5','C5')), (1, ('C3','D3'), ('C7','D7')), (2, ('C3','D3'), ('C7','D7'))]:
            with self.subTest(table=target):
                tables = self.tables()
                for a,b in (headers,values): tables[target][a],tables[target][b] = tables[target][b],tables[target][a]
                with self.assertRaisesRegex(ValueError, 'product columns'):
                    producer.check_ec_tables(*tables, '2026-11-02')

    def test_currency_date_units_and_table_identity_fail_closed(self):
        changes = [(0,'A1','in USD'), (0,'A2','1'), (0,'B2','kg'), (1,'C4','kg'), (1,'C1','Excises in BGN'), (2,'C1','Other taxes'), (0,'A5','Belgium')]
        for target, key, value in changes:
            with self.subTest(table=target,field=key):
                tables=self.tables();tables[target][key]=value
                with self.assertRaises(ValueError):producer.check_ec_tables(*tables, '2026-11-02')

    def test_named_sheet_is_required(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'wrong.xlsx'
            with zipfile.ZipFile(p,'w') as z:
                z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Other"/></sheets></workbook>')
            with self.assertRaisesRegex(ValueError,'worksheet'):producer.sheet(p,'VAT')

    def test_ec_excise_must_reconcile_to_statutory_bgn(self):
        reference=json.loads((ROOT/evidence.OUTPUT).read_text())['fuels']
        for fuel, source in reference.items():
            self.assertEqual(float(producer.checked_euro_excise(str(source['originalExcise']), str(source['originalBgnPer1000']))), source['originalExcise'])
            other=reference['diesel' if fuel == 'petrol' else 'petrol']['originalExcise']
            with self.assertRaises(ValueError):producer.checked_euro_excise(str(other),str(source['originalBgnPer1000']))
            with self.assertRaises(ValueError):producer.checked_euro_excise(str(source['originalBgnPer1000']),str(source['originalBgnPer1000']))

    def test_nsi_uses_the_year_column_instead_of_the_expected_answer(self):
        text='(Левове)\n(BGN)\n2024\n2025\n2026\nЦигари с филтър - кутия\n6.87\n7.20\n8.10 English label\n'
        value, _, years=producer.parse_nsi_pack_table(text)
        self.assertEqual(value,7.20)
        self.assertEqual(years,[2024,2025,2026])

    def test_nsi_ambiguity_missing_cells_and_wrong_currency_are_rejected(self):
        base='(Левове)\n(BGN)\n2024\n2025\nЦигари с филтър - кутия\n6.87\n7.20\n'
        variants=[base.replace('2024\n2025','2025\n2025'),base.replace('2024\n2025','2023\n2024'),base+'Цигари с филтър - кутия\n6.87\n7.20',base.replace('7.20','7.20\n8.10'),base.replace('7.20','.'),base.replace('(BGN)','(USD)'),base.replace('Цигари','2024\n2025\nХрани\nЦигари')]
        for text in variants:
            with self.subTest(text=text):
                with self.assertRaises(ValueError):producer.parse_nsi_pack_table(text)

    def test_frozen_evidence_is_reproducible_from_originals(self):
        if not all((ROOT/path).exists() for path in evidence.FILES.values()):
            self.skipTest('large originals require the pinned input archive')
        self.assertEqual(evidence.extract(ROOT),json.loads((ROOT/evidence.OUTPUT).read_text()))


class ActiveValidatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = producer.extract() if all((ROOT/path).exists() for path in evidence.FILES.values()) else json.loads((ROOT/'data/release/indirect-tax-parameters.json').read_text())

    def validate(self, dataset):
        real_load=validator.load
        with patch.object(validator,'load',side_effect=lambda path:dataset if path=='indirect-tax-parameters.json' else real_load(path)):
            return validator.check(None)

    def test_untaxed_bucket_is_defined_separately_from_extracted_rates(self):
        self.assertEqual(self.dataset['vat']['untaxed']['kind'], 'definition')
        self.assertTrue(self.dataset['vat']['untaxed']['basis'].startswith('ЗДДС'))
        self.assertNotIn('zeroPct', self.dataset['vat'])
        frozen = json.loads((ROOT/evidence.OUTPUT).read_text())
        self.assertEqual(set(frozen['vat']), {'standardPct', 'reducedPct', 'standardSince', 'unit'})

    def test_actual_evidence_passes(self):
        self.assertEqual(self.validate(copy.deepcopy(self.dataset)).problems,[])

    def test_mutated_vat_and_schedule_fail_the_active_validator(self):
        mutations = [
            ('VAT standard 99',lambda d:d['vat'].update(standardPct=99)),
            ('VAT reduced 99',lambda d:d['vat'].update(reducedPct=99)),
            ('zero presented as extracted rate',lambda d:d['vat'].update(zeroPct=0)),
            ('untaxed presented as extracted',lambda d:d['vat']['untaxed'].update(kind='extracted')),
            ('untaxed without legal basis',lambda d:d['vat']['untaxed'].update(basis='')),
            ('VAT units',lambda d:d['vat'].update(unit='fraction')),
            ('VAT validity',lambda d:d['vat'].update(standardSince='2020-01-01')),
            ('VAT sources',lambda d:d['vat'].update(source=[])),
            ('empty schedule',lambda d:d.update(cigarettes=[])),
            ('missing first period',lambda d:d['cigarettes'].pop(0)),
            ('missing last period',lambda d:d['cigarettes'].pop()),
            ('period gap',lambda d:d['cigarettes'][0].update(validTo='2027-02-27')),
            ('period overlap',lambda d:d['cigarettes'][1].update(validFrom='2027-02-28')),
            ('specific coefficient',lambda d:d['cigarettes'][0].update(specificPer1000=99)),
            ('ad valorem coefficient',lambda d:d['cigarettes'][1].update(adValoremPct=99)),
            ('minimum coefficient',lambda d:d['cigarettes'][2].update(minimumPer1000=99)),
            ('petrol coefficient',lambda d:d['fuels']['petrol'].update(excisePerLitre=d['fuels']['diesel']['excisePerLitre'])),
            ('fuel observation date',lambda d:d['fuels']['diesel'].update(priceDate='2026-09-21')),
            ('statutory conversion',lambda d:d['fuels']['petrol']['legalEvidence'].update(conversionRate=2)),
            ('NSI price',lambda d:d['references']['pack'].update(originalValue=7.20)),
            ('NSI year columns',lambda d:d['references']['pack'].update(yearHeaders=[2024])),
        ]
        for name, change in mutations:
            with self.subTest(mutation=name):
                dataset=copy.deepcopy(self.dataset);change(dataset)
                self.assertTrue(self.validate(dataset).problems,name)


if __name__ == '__main__':
    unittest.main()
