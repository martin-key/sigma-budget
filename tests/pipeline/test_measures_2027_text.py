"""The editorial companion of tables II-7 and II-8 (apps/web/client/measures-2027.js) against the pinned motives PDF and the release.

Every quote must stand word for word on its pages of ZDBRB-2027/4-UMTBF-2027-2029-motivi.pdf, every entry must belong to the printed
row in the same position, its table page must be the page of that row's cells in budget2027-provenance.json, a named law must be in the
quote or the row, and every number in a title or a plain sentence must come from the quote or the printed row of the same measure.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unittest
import zipfile

import fitz

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'data/originals/budget_2027/ZDBRB-2027.zip'
MEMBER = 'ZDBRB-2027/4-UMTBF-2027-2029-motivi.pdf'
MODULE = ROOT / 'apps/web/client/measures-2027.js'
NUMBER = re.compile(r'\d+(?: \d{3})*(?:,\d+)?')


def norm(text):
    """One line of text: a hyphen at the end of a line stays in its word, every run of white space is one space."""
    text = re.sub(r'(?<=[А-Яа-яA-Za-z])-\n(?=[а-яa-z])', '-', text)
    return re.sub(r'\s+', ' ', text).strip()


def numbers(text):
    return set(NUMBER.findall(norm(text)))


class Measures2027TextTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.check_output(
            ['node', '--input-type=module', '-e',
             f"import {{ MEASURES_2027, LAWS }} from {json.dumps(MODULE.as_uri())}; "
             "console.log(JSON.stringify({ measures: MEASURES_2027, laws: LAWS }));"],
            cwd=ROOT)
        loaded = json.loads(out)
        cls.measures, cls.laws = loaded['measures'], loaded['laws']
        provenance = json.loads((ROOT / 'data/release/budget2027-provenance.json').read_text(encoding='utf-8'))
        member = provenance['documents']['forecast']
        with zipfile.ZipFile(ARCHIVE) as z:
            data = z.read(MEMBER)
        assert member['member'] == MEMBER and hashlib.sha256(data).hexdigest() == member['memberSha256']
        doc = fitz.open(stream=data, filetype='pdf')
        cls.pages = {}
        for n in range(40, 56):
            text = norm(doc[n - 1].get_text())
            # the printed page number opens every page; drop it so that a paragraph can run on to the next page
            cls.pages[n] = re.sub(rf'^{n} ', '', text)
        cls.release = json.loads((ROOT / 'data/release/budget2027.json').read_text(encoding='utf-8'))
        cls.entries = provenance['entries']

    def each(self):
        for table, entries in self.measures.items():
            rows = self.release['forecast'][table]
            for i, entry in enumerate(entries):
                yield table, i, entry, rows[i]

    def test_one_entry_per_printed_measure(self):
        for table, entries in self.measures.items():
            rows = self.release['forecast'][table]
            self.assertEqual(rows[-1]['label'], 'Общо:', table)
            self.assertEqual(len(entries), len(rows) - 1, table)
        ids = [e['id'] for entries in self.measures.values() for e in entries]
        self.assertEqual(len(ids), len(set(ids)))
        for value in ids:
            self.assertRegex(value, r'^[a-z0-9-]+$')

    def test_entries_follow_the_printed_rows(self):
        for table, i, entry, row in self.each():
            with self.subTest(table=table, row=i):
                self.assertTrue(norm(row['label']).startswith(norm(entry['starts'])), (entry['starts'], row['label']))

    def test_quotes_are_verbatim_on_their_pages(self):
        for table, i, entry, _ in self.each():
            with self.subTest(table=table, id=entry['id']):
                last = entry.get('to', entry['page'])
                self.assertGreaterEqual(last, entry['page'])
                text = ' '.join(self.pages[n] for n in range(entry['page'], last + 1))
                self.assertIn(norm(entry['quote']), text)
                # the quote really starts on its first page
                self.assertIn(norm(entry['quote'])[:60], self.pages[entry['page']])

    def test_table_page_is_the_page_of_the_row(self):
        for table, i, entry, row in self.each():
            with self.subTest(table=table, id=entry['id']):
                pages = {self.entries[c['provenance']]['page'] for c in row['cells'].values()}
                self.assertEqual(pages, {entry['tablePage']})

    def test_named_laws_are_in_the_source(self):
        for table, i, entry, row in self.each():
            law = entry.get('law')
            if not law:
                continue
            with self.subTest(table=table, id=entry['id']):
                self.assertIn(law, self.laws)
                source = norm(entry['quote'] + ' ' + row['label'])
                # an abbreviation is printed as it is; a full name follows a preposition with its article („по Закона за …“)
                self.assertTrue(law in source or re.sub(r'^Закон ', 'Закона ', law) in source, law)

    def test_editorial_numbers_come_from_the_source(self):
        for table, i, entry, row in self.each():
            with self.subTest(table=table, id=entry['id']):
                source = numbers(entry['quote']) | numbers(row['label'])
                for field in ('name', 'text'):
                    self.assertLessEqual(numbers(entry[field]), source, (field, entry[field]))


if __name__ == '__main__':
    unittest.main()
