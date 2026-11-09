"""Re-run the unchanged Python producer using only frozen reader evidence."""
import importlib.util
import json
import os
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ['BUILD_DATE'] = '2026-11-08'

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

def main():
    raw = json.loads((HERE / 'reader-ir.json').read_text())
    for name in ('budget_pipeline', 'budget_pipeline.build'):
        package = types.ModuleType(name)
        package.__path__ = []
        sys.modules[name] = package
    load('budget_pipeline.build.data_io', HERE / 'data_io_donor.py')
    donor = load('indirect_taxes_donor', HERE / 'donor.py')

    class FakePath:
        def __init__(self, path=''): self.path = path
        def __truediv__(self, child): return FakePath(self.path + '/' + child)
        @property
        def name(self): return self.path.rsplit('/', 1)[-1]
        def read_text(self): return ''

    class Text:
        def __init__(self): self.parts = raw['gazetteParts']
        def feed(self, _): pass

    class Pdf:
        def __init__(self, pages): self.pages = pages
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def __iter__(self):
            return iter(types.SimpleNamespace(get_text=lambda text=text: text) for text in self.pages)

    donor.RAW = FakePath()
    donor.Text = Text
    donor.sheet = lambda path, title: raw[{'Sheet1': 'prices', 'Excise duties': 'duties', 'VAT': 'vat'}[title]]
    donor.fitz = types.SimpleNamespace(open=lambda path: Pdf(raw['nsiPages'] if 'nsi-pack' in path.path else raw['customsPages']))
    donor.Document = lambda _: types.SimpleNamespace(tables=[types.SimpleNamespace(rows=[
        types.SimpleNamespace(cells=[types.SimpleNamespace(text=cell) for cell in row])
        for row in table]) for table in raw['docxTables']])
    actual = donor.extract()
    expected = json.loads((HERE / 'oracle.json').read_text())
    if actual != expected: raise SystemExit('indirect-tax donor differs from frozen oracle')
    print('indirect-tax donor: reader IR reproduces frozen output')

if __name__ == '__main__':
    main()
