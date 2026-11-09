"""Execute frozen 9d donors against frozen fiscal inputs, without live reads."""
import ast
import hashlib
import json
import os
import socket
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FISCAL = HERE.parent / 'fiscal'
HASHES = {
    'annual_periods.py': '3a036c4d9e999897dc4737340da72772a27b8c1e40e3c5bff4f5b678d11a41cb',
    'budget_2027.py': 'dab10117524264be11f28be6d8325ca0b089f646d801751c0bd7974943d2850f',
    'data_io.py': 'b827a40fe5c979f2cf0d689766fedc355fddeb8c897460578d6aeb26364b9d68',
}
if sys.version_info[:2] != (3, 12):
    raise SystemExit('Python 3.12 required')
if sys.argv[1:] not in ([], ['--check']):
    raise SystemExit('usage: generate_budget.py [--check]')
check = bool(sys.argv[1:])
manifest = (HERE / 'inputs-sha256.json').read_bytes()
if hashlib.sha256(manifest).hexdigest() != '3e8b1ed66d5f3aeb221bda7cf9a56e880d632ceb96d68929f76434996660b2e2':
    raise ValueError('Frozen input inventory changed')
inputs = json.loads(manifest)
for name, expected in inputs.items():
    path = HERE.parent / name
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError('Frozen input changed: ' + name)

os.environ['BUILD_DATE'] = '2026-11-08'
socket.socket = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('network denied'))

def emit(name, obj):
    data = (json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode()
    dest = HERE / name
    if check:
        if dest.read_bytes() != data:
            raise ValueError('Oracle differs: ' + name)
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    return hashlib.sha256(data).hexdigest()

with tempfile.TemporaryDirectory(prefix='sigma13a-') as tmp:
    pkg = Path(tmp) / 'budget_pipeline' / 'build'
    pkg.mkdir(parents=True)
    (pkg.parent / '__init__.py').write_text('')
    (pkg / '__init__.py').write_text('')
    for name, expected in HASHES.items():
        data = (HERE / 'donor' / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Donor changed: ' + name)
        (pkg / name).write_bytes(data)
    sys.path.insert(0, tmp)
    from budget_pipeline.build import annual_periods, budget_2027
    annual_periods.ROOT = FISCAL / 'inputs'
    annual_periods.SRC = FISCAL / 'inputs/data/inputs'
    lineage = annual_periods.Lineage()
    annual = annual_periods.annual(lineage)
    output = {'annual.json': annual, 'annual-entries.json': dict(lineage.entries)}
    class Context:
        annual_lineage = lineage
        def put(self, name, value): output[name] = value
    budget_2027.build_budget_2027(Context())
    # Mutations retain the verified archive, but exercise donor behavior in memory.
    import copy
    changed = annual_periods.Lineage()
    changed.inputs['F']['tables']['II_7']['rows'][0]['values'] = [123.0, -12.5, 9.0]
    changed.inputs['F']['tables']['II_7']['rows'][0]['printed'] = ['123,0', '-12,5', '9,0']
    changed.inputs['B']['articles']['67'][0]['text'] = 'Граничен размер 31,25 млрд. евро.'
    changed.inputs['B']['bill']['1']['rows'][0]['value'] = None
    del changed.inputs['B']['bill']['2']
    changed_output = budget_2027.budget(changed)
    output['changed.json'] = {'measures': changed_output['forecast']['II_7'][0], 'debt67': changed_output['debtLimits']['67'], 'bill1rows': changed_output['budgets']['bill']['1']['rows'], 'billMc1rows': changed_output['budgets']['billMc']['1']['rows'], 'billMcOnly': changed_output['budgets']['billMc']['2']}
    cell_cases = []
    for text in ('-', ' 1\u0085 234,5 ', '', '0x10', '3x', '\ufeff1'):
        try:
            cell_cases.append({'text': text, 'value': budget_2027.numeric_cell(text)})
        except ValueError:
            cell_cases.append({'text': text, 'error': 'invalid'})
    sample_bill = {'tables': [{'id': 't', 'page': 1, 'rawCells': [['X', '10'], ['X', '10']]}]}
    sample_row = {'name': 'X', 'values': [10], 'page': 1}
    try:
        budget_2027.physical_cell(sample_bill, sample_row, '/municipal/art52/rows/0/values/0', 10, 1)
        ambiguous = False
    except ValueError:
        ambiguous = True
    table = {'rawCells': [['1', '1.0']]}
    output['physical-cases.json'] = {'numeric': cell_cases, 'ambiguous': ambiguous,
                                     'printedInt': budget_2027.printed_value(table, 1),
                                     'printedFloat': budget_2027.printed_value(table, 1.0)}
    negatives = {}
    for table_name, col, period in [('annex1_execution2026', 0, '2026.law'),
                                    ('annex3_mln', 1, '2026.expected'),
                                    ('annex3_mln', 2, '2027.draft'),
                                    ('annex3_mln', 3, '2028.forecast'),
                                    ('annex3_mln', 4, '2029.forecast')]:
        column = lineage.inputs['F']['tables'][table_name]['columns'][col]
        old = column['vintage']
        column['vintage'] = 'отчет'
        try:
            lineage.f(table_name, 0, col, 'negative.json#/value', period)
            negatives[period] = False
        except ValueError:
            negatives[period] = True
        finally:
            column['vintage'] = old
    for key in ('archiveSha256', 'memberSha256'):
        document = dict(lineage.documents['forecast'])
        document[key] = '0' * 64
        try:
            annual_periods.Lineage._verify_document(document)
            negatives[key] = False
        except ValueError:
            negatives[key] = True
    output['negative-cases.json'] = negatives
    # The required subscription is distinct from the donor's explicit blank fallback.
    label_cases = []
    for variant in ('bill', 'billMc'):
        for section in ('rows', 'policiesRows', 'commitmentRows'):
            article, row_index = next(
                (article, i)
                for article, item in lineage.inputs['B'][variant].items()
                for i, row in enumerate(item[section])
                if row.get('value') is not None
            )
            for state in ('missing', 'null', 'empty', 'skipped'):
                probe = annual_periods.Lineage()
                row = probe.inputs['B'][variant][article][section][row_index]
                if state in ('missing', 'skipped'):
                    del row['text']
                else:
                    row['text'] = None if state == 'null' else ''
                if state == 'skipped':
                    row['value'] = None
                captured = {'variant': variant, 'article': article, 'section': section,
                            'rowIndex': row_index, 'state': state}
                try:
                    projected = {'budgets': {}}
                    budget_2027.add_budgets(probe, projected)
                    rows = projected['budgets'][variant][article][section]
                    captured['count'] = len(rows)
                    if state != 'skipped':
                        captured['label'] = rows[0]['label']
                except Exception as error:
                    captured['error'] = type(error).__name__
                    captured['message'] = str(error)
                label_cases.append(captured)
    output['label-cases.json'] = label_cases
    metadata_cases = []
    original_load = annual_periods.jload
    def capture_metadata(kind, path, phase, op='delete', value=None):
        captured = {'kind': kind, 'path': path, 'phase': phase, 'op': op}
        if op == 'set':
            captured['value'] = value
        def mutate(obj):
            node = obj
            for key in path[:-1]:
                node = node[key]
            if op == 'set':
                node[path[-1]] = value
            else:
                del node[path[-1]]
            if op == 'blank':
                node['values'] = [None] * len(node['values'])
        try:
            if phase == 'construct':
                def load_case(filename):
                    obj = original_load(filename)
                    if filename.name == f'budget_{"forecast" if kind == "F" else "bill"}_2027.json':
                        mutate(obj)
                    return obj
                annual_periods.jload = load_case
                annual_periods.Lineage()
            else:
                probe = annual_periods.Lineage()
                mutate(probe.inputs[kind])
                if phase == 'rows':
                    projected = {'budgets': {}}
                    budget_2027.add_budgets(probe, projected)
                    captured['fieldValue'] = projected['budgets'][path[0]][path[1]]['name']
                elif phase == 'forecastCell':
                    captured['column'] = next(i for i, column in enumerate(probe.inputs['F']['tables']['II_5']['columns']) if column.get('year') == 2027)
                    probe.f('II_5', 0, captured['column'], 'probe.json#/cell', '2027.draft')
                else:
                    projected = {'municipal': {}, 'projects': [], 'forecast': {}}
                    {'municipal': budget_2027.add_municipalities, 'projects': budget_2027.add_projects, 'debt': budget_2027.add_debt_limits, 'forecast': budget_2027.add_forecast}[phase](probe, projected)
        except Exception as error:
            captured['error'] = type(error).__name__
        finally:
            annual_periods.jload = original_load
        metadata_cases.append(captured)
    for variant in ('bill', 'billMc'):
        capture_metadata('B', [variant, '1', 'name'], 'rows')
        for value in (None, ''):
            capture_metadata('B', [variant, '1', 'name'], 'rows', 'set', value)
    for section in ('art52', 'art53'):
        capture_metadata('B', ['municipal', section, 'rows', 0, 'region'], 'municipal')
    for field in ('id', 'name', 'institution'):
        capture_metadata('B', ['projects', 'rows', 0, field], 'projects')
    capture_metadata('B', ['articles', '66', 0, 'page'], 'debt')
    capture_metadata('F', ['tables', 'II_5', 'rows', 0, 'label'], 'forecastCell')
    capture_metadata('F', ['tables', 'II_5', 'rows', 0, 'label'], 'forecast', 'blank')
    for kind in ('F', 'B'):
        capture_metadata(kind, ['source', 'archive'], 'construct')
        for value in (None, ''):
            capture_metadata(kind, ['source', 'archive'], 'construct', 'set', value)
    output['metadata-cases.json'] = metadata_cases
    number_cases = []
    for token in ('1', '1.0', '1e0', '0.0', 'false', 'true', 'fallback-n'):
        probe = annual_periods.Lineage()
        row = probe.inputs['B']['bill']['1']['rows'][0]
        row['no'] = json.loads(token) if token != 'fallback-n' else 0
        if token == 'fallback-n':
            row['n'] = 1.0
        input_row = json.dumps(row, ensure_ascii=False)
        projected = {'budgets': {}}
        budget_2027.add_budgets(probe, projected)
        target = projected['budgets']['bill']['1']['rows'][0]
        number_cases.append({'token': token, 'inputRow': input_row, 'targetNo': target['no'],
                             'display': probe.entries[target['cell']['provenance']]['no']})
    reader_cases = []
    for name in ('explicit', 'missing-pages', 'missing-id', 'missing-table-page',
                 'default-pages', 'empty-pages', 'null-pages', 'explicit-id', 'null-id'):
        row = {'name': 'X', 'values': [10], 'page': 1}
        table = {'id': 't', 'page': 1, 'rawCells': [['X', '10']]}
        sample = {'tables': [table], 'municipal': {'art52': {'rows': [row]}}}
        if name in ('explicit', 'missing-pages', 'missing-id'):
            row['table'] = 't'
        if name == 'missing-pages':
            del row['page']
            del table['page']
        if name == 'missing-id':
            sample['tables'].insert(0, {'page': 2, 'rawCells': [['Z', '20']]})
        if name == 'missing-table-page':
            sample['tables'].insert(0, {'id': 'unrelated', 'rawCells': [['Z', '20']]})
        if name in ('empty-pages', 'null-pages'):
            row['pages'] = [] if name == 'empty-pages' else None
        if name == 'explicit-id':
            row['id'] = 'other'
        if name == 'null-id':
            row['id'] = None
            sample['tables'].append({'id': 'other', 'page': 1, 'rawCells': [['Y', '10']]})
        captured = {'name': name, 'bill': sample}
        try:
            table_id, page, printed, location = budget_2027.physical_cell(sample, row, '/municipal/art52/rows/0/values/0', 10, 1)
            captured['expected'] = {'table': table_id, 'page': page, 'printed': printed, **location}
        except Exception as error:
            captured['error'] = type(error).__name__
        reader_cases.append(captured)
    output['reader-cases.json'] = {'numbers': number_cases, 'physical': reader_cases}
    hashes = {name: emit('oracle/' + name, value) for name, value in output.items()}

    law_source = (HERE / 'law-donor.py').read_bytes()
    tree = ast.parse(law_source)
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'next_budget')
    namespace = {}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[])), 'law-donor.py', 'exec'), namespace)
    owners = {}
    for name in ('outlook', 'revenue', 'expenditure'):
        legacy = json.loads((FISCAL / 'donor' / (name + '.json')).read_text())
        legacy['byPeriod'] = annual[name]
        owners[name + '.json'] = legacy
    law = json.loads((HERE.parent / 'law/oracle.json').read_text())
    law['next'] = namespace['next_budget'](output['budget2027.json'])
    owners['law.json'] = law
    for name in ('budget2027.json', 'budget2027-provenance.json'):
        owners[name] = output[name]
    for name, value in owners.items():
        hashes['final/' + name] = emit('final/' + name, value)
        published = json.loads((HERE / 'published' / name).read_text())
        if value != published:
            raise ValueError('Published mismatch: ' + name)
    emit('oracle/inventory.json', {'baseline': '9d7e91001d25c815f1dc93163ef5809c00e060c8', 'buildDate': '2026-11-08', 'donors': HASHES, 'inputs': inputs, 'outputs': hashes,
        'sourceRoles': {'annual_periods.py': 'annual projection and lineage', 'budget_2027.py': 'bill, forecast and provenance', 'data_io.py': 'serialization metadata and injected paths', 'law-donor.py': 'current-publication pointer', 'fiscal/donor': 'independent legacy owner preimages', 'law/oracle.json': 'independent legacy law preimage', 'published': 'comparison targets only'}})
print('budget donor oracle: byte-identical' if check else 'budget donor oracle: regenerated')
