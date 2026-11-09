#!/usr/bin/env python3
"""Run frozen 10697 aggregation donors and scoped publication layers offline."""
import argparse, ast, hashlib, importlib, json, os, shutil, sys, tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
BASELINE = '10697d0def6ff6892029a311e2b590602e66b931'
OUTPUTS = ('core.json', 'feed.json', 'feed.xml', 'search-index.json')

def jload(p):
    return json.loads(Path(p).read_text(encoding='utf8'))
def write_json(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n', encoding='utf8')
def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--check', action='store_true'); args = ap.parse_args()
    if sys.version_info[:2] != (3, 12): raise RuntimeError('Python 3.12 required')
    manifest = jload(HERE/'provenance.json')
    assert manifest['baseline'] == BASELINE
    for path, expected in manifest['files'].items():
        assert digest(HERE/path) == expected, 'hash mismatch: ' + path
    os.environ['BUILD_DATE'] = '2026-11-08'; os.environ.pop('BNS_SITE_URL', None)
    sys.path.insert(0, str(HERE/'donor'))
    from budget_pipeline.build import data_io, definitions, core, feed, search, active_data, apply_sources, wording
    from budget_pipeline.validate import execution_contract
    class Context:
        def __init__(self, release):
            self.release = release
            self.out = {}
            self.texts = {}
            self.notes = []
            # These are owner-stage snapshots, not this scope's outputs.
            for p in (HERE/'upstream').rglob('*.json'):
                rel = p.relative_to(HERE/'upstream').as_posix()
                if rel not in ('glossary.json','guide.json','catalog.json','dbp2027.json','gva-sectors.json'):
                    self.out[rel] = jload(p)
            self.execution = execution_contract.numbers(jload(HERE/'upstream/execution.json'))
            self.law = jload(HERE/'archive/cache/law_bill.json')
            self.tables = jload(HERE/'archive/originals/asbp/asbp_tables.json')['tables']
        def get(self, rel, default=None): return self.out.get(rel, default)
        def put(self, rel, obj): self.out[rel] = obj; return obj
        def put_text(self, rel, text): self.texts[rel] = text; return text
        def src(self, name): return jload(HERE/'inputs'/ (name+'.json'))
        def raw(self, rel): return jload(HERE/'archive/originals'/rel)
        def cache(self, rel): return jload(HERE/'archive/cache'/rel)
    with tempfile.TemporaryDirectory(prefix='aggregation-oracle-') as tmp:
        sandbox=Path(tmp); release=sandbox/'data/release'; shutil.copytree(HERE/'upstream', release)
        (sandbox/'data/inputs').mkdir(parents=True)
        shutil.copy2(HERE/'inputs/wording.json', sandbox/'data/inputs/wording.json')
        ctx=Context(release)
        core.DATA = release; search.DATA = release
        definitions.set_kfp_pending(ctx.execution)
        authored={'sources':definitions.SOURCES, 'pending':definitions.PENDING_DEFS, 'budgetCount':len(definitions.EBK_ART), 'catalogDefinitions':search.DEFS, 'catalogGroups':search.CATALOG_GROUPS, 'populationAsOf':definitions.POPULATION_ASOF, 'functionDefs':definitions.FUNCTION_DEFS, 'budgetInfo':definitions.BUDGET_INFO, 'searchKeywords':{'revenue':search._RG_KW,'function':search._FN_KW,'economic':search._ECON,'measure':search._MEASURE_KIND,'status':search._DS_STATUS}}
        # The scoped glue literals come from the unchanged apply_sources donor AST.
        tree = ast.parse((HERE/'donor/budget_pipeline/build/apply_sources.py').read_text())
        main_fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        literals = [n for n in main_fn.body if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ('CAT','SEE','NOTE_BASIS','TERMS')]
        namespace = {}; exec(compile(ast.Module(body=literals, type_ignores=[]), '<donor-glue>', 'exec'), namespace)
        source_records = {}
        for n in ast.walk(main_fn):
            if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Subscript):
                target=n.targets[0]
                if isinstance(target.value, ast.Subscript) and isinstance(target.value.value,ast.Name) and target.value.value.id=='core' and isinstance(target.value.slice,ast.Constant) and target.value.slice.value=='sources' and isinstance(target.slice,ast.Constant):
                    source_records[target.slice.value]=ast.literal_eval(n.value)
        authored['sourceGlue']={'sources':source_records,'terms':namespace['TERMS']}
        feed.build_feed(ctx); core.build_core(ctx); search.search(ctx)
        raw={name: (ctx.texts[name].encode() if name.endswith('.xml') else (data_io.jdumps(ctx.out[name])+'\n').encode()) for name in OUTPUTS}
        for name, b in raw.items(): (release/name).write_bytes(b)
        # Production ordering: wording(core/search), active_data, then source glue.
        wording.ROOT = sandbox
        for name in ('core.json','search-index.json'):
            sys.argv=['wording',name,'data/release']; wording.main()
        sys.argv=['active_data',str(release),'--apply']; active_data.main()
        apply_sources.W = sandbox; apply_sources.main()
        final={name:(release/name).read_bytes() for name in OUTPUTS}
        # Changed owner data and explicit disk fallbacks exercise the donor, not TS output.
        changed = Context(release)
        changed.out['outlook.json']['gdp']['mln'][2] = 12345
        changed.out['measures.json']['items'].pop()
        changed.out.pop('municipalities.json')
        glossary = release/'glossary.json'; saved_glossary = glossary.read_bytes(); glossary.unlink()
        try:
            core.build_core(changed)
        finally:
            glossary.write_bytes(saved_glossary)
        altered_feed = Context(release)
        altered_feed.out['budget2027.json']['publication'] = '2026-11-07'
        altered_feed.out['law.json']['timeline'][0]['title'] = 'Промяна & <данни>'
        altered_feed.out['sebra.json']['overall']['count'] += 1
        altered_feed.out['rates.json']['meta']['asOf'] = '2026-08-13'
        annual = altered_feed.raw('eurostat/gov_10dd_edpt1_BG_EU.json'); annual['updated'] = '2026-10-22T11:00:00+0200'
        quarterly = altered_feed.raw('eurostat/gov_10q_ggdebt_BG.json'); quarterly['updated'] = '2026-10-23T11:00:00+0200'
        altered_feed.out['debt.json']['latest']['maastricht']['asOf'] = '2026-10-22'
        altered_feed.out['debt.json']['latest']['maastricht']['quarter']['asOf'] = '2026-10-23'
        old_raw, old_src = altered_feed.raw, altered_feed.src
        altered_feed.raw = lambda rel: annual if 'gov_10dd_edpt1' in rel else quarterly if 'gov_10q_ggdebt' in rel else old_raw(rel)
        cofog = old_src('cofog_bg'); cofog['updated'] = '2026-09-17T23:00:00+0200'
        altered_feed.src = lambda name: cofog if name == 'cofog_bg' else old_src(name)
        feed.build_feed(altered_feed)
        altered_search = Context(release)
        altered_search.out['core.json'] = ctx.out['core.json']
        altered_search.out['feed.json'] = ctx.out['feed.json']; altered_search.texts['feed.xml'] = ctx.texts['feed.xml']
        budget = altered_search.out['budget2027.json']
        budget['budgets']['bill'] = dict(reversed(list(budget['budgets']['bill'].items())))
        budget['municipal']['art52'][0]['cells'][0]['value'] = 1234.5
        budget['forecast']['II_7'][0]['cells'].pop('1', None)
        altered_search.out['measures.json']['items'][0]['name'] = 'Мярка & <проект>'
        altered_search.out['outlook.json']['meta']['source'] = ['sebra', 'ec-oil', 'asbp']
        search.search(altered_search)
        edge = Context(release); edge.out['core.json'] = ctx.out['core.json']; edge.out['feed.json'] = ctx.out['feed.json']; edge.texts['feed.xml'] = ctx.texts['feed.xml']
        edge.out['measures.json']['items'][0]['text'] += ' ' + 'a' * 531
        search.search(edge)
        assert len((data_io.jdumps(edge.out['search-index.json']) + '\n').encode()) == 249999
        edge.out['measures.json']['items'][0]['text'] += 'a'
        try: search.search(edge)
        except ValueError as exc: assert '250000 B raw' in str(exc)
        else: raise AssertionError('Python accepted the search byte limit')
        pending_case = Context(release)
        pending_case.execution['pendingMonths'][0]['month'] = 11
        pending_case.execution['pendingMonths'][0]['asOf'] = '2026-11-30'
        definitions.set_kfp_pending(pending_case.execution)
        core.build_core(pending_case); feed.build_feed(pending_case)
        definitions.set_kfp_pending(ctx.execution)
        sample_rows = search._Rows()
        sample_rows.add('indicators', 'Тест', value=[], period='2026', href='#/pari')
        sample_rows.add('datasets', True, '\u0085  текст  \u0085', ['кирилица', 2], {'a': True}, href='#/danni/test')
        # Direct-builder regressions: textual numeric identifiers and required projections.
        regressions = {'programs': [], 'missingCore': []}
        for field in ('code', 'ministry', 'name'):
            for token in ('1', '1.0', '1e0', '-0.0', '1e-5', '1e16', '1.25', '1e-4',
                          '"__proto__"', '"constructor"'):
                case = Context(release)
                case.out['core.json'] = ctx.out['core.json']
                case.out['feed.json'] = ctx.out['feed.json']
                case.texts['feed.xml'] = ctx.texts['feed.xml']
                programs = case.out['programs.json']
                fields = {name: i for i, name in enumerate(programs['fields'])}
                row_index, row = next((i, row) for i, row in enumerate(programs['items'])
                                      if row[fields['level']] != 'policy' and row[fields['name']])
                row[fields[field]] = json.loads(token)
                search.search(case)
                href = '#/vedomstvo/%s/%s?per=2026.law' % (row[fields['ministry']], row[fields['code']])
                result = next((entry for entry in case.out['search-index.json']['items']
                               if entry[6] == href and entry[1] == str(row[fields['name']])), None)
                assert (result is None) == (not row[fields['name']])
                regressions['programs'].append({'field': field, 'token': token,
                                                'row': row_index, 'href': href, 'expected': result})
        missing = [
            ('revenue', ['groups', 0, key]) for key in ('id', 'name', 'share2026')
        ] + [('revenue', ['groups', 0, 'mln', 2])] + [
            ('expenditure', ['functions', 'items', 0, key])
            for key in ('id', 'name', 'short', 'yoy2026Pct')
        ] + [
            ('expenditure', ['functions', 'items', 0, key, 1])
            for key in ('mln', 'pctGdp', 'share')
        ] + [
            ('execution', ['latest', 'kfp', 'rev', key])
            for key in ('plan', 'cum', 'pctPlan', 'prevYearCum')
        ] + [('outlook', ['gdp', 'mln', 2])]
        for owner, path in missing:
            case = Context(release)
            node = case.execution if owner == 'execution' else case.out[owner + '.json']
            for key in path[:-1]: node = node[key]
            if isinstance(node, list): del node[path[-1]:]
            else: del node[path[-1]]
            try: core.build_core(case)
            except (KeyError, IndexError) as exc:
                regressions['missingCore'].append({'owner': owner, 'path': path,
                                                  'error': type(exc).__name__})
            else: raise AssertionError('Donor accepted missing core field: ' + repr((owner, path)))
        nullable = Context(release)
        nullable.out['revenue.json']['groups'][0]['share2026'] = None
        core.build_core(nullable)
        regressions['nullableCoreGroup'] = nullable.out['core.json']['revenueGroups'][0]
        # Exercise apply_sources' missing-five-term branch in a second isolated tree.
        glue_root = sandbox/'glue-case'; glue_release = glue_root/'data/release'
        shutil.copytree(HERE/'upstream', glue_release)
        (glue_root/'data/inputs').mkdir(parents=True)
        shutil.copy2(HERE/'inputs/wording.json', glue_root/'data/inputs/wording.json')
        glossary64 = jload(glue_release/'glossary.json'); glossary64['terms'] = glossary64['terms'][:64]
        glossary64['categories'] = [c for c in glossary64['categories'] if c['id'] != 'byudzhet-2027']
        write_json(glue_release/'glossary.json', glossary64)
        glue_ctx = Context(glue_release); core.DATA = glue_release; search.DATA = glue_release
        feed.build_feed(glue_ctx); core.build_core(glue_ctx); search.search(glue_ctx)
        for name in OUTPUTS:
            (glue_release/name).write_bytes(glue_ctx.texts[name].encode() if name.endswith('.xml') else (data_io.jdumps(glue_ctx.out[name])+'\n').encode())
        wording.ROOT=glue_root
        for name in ('core.json','search-index.json'):
            sys.argv=['wording',name,'data/release']; wording.main()
        sys.argv=['active_data',str(glue_release),'--apply']; active_data.main()
        apply_sources.W=glue_root; apply_sources.main()
        core.DATA = release; search.DATA = release
        artifacts={'authored.json':(json.dumps(authored,ensure_ascii=False,separators=(',',':'))+'\n').encode(),
                   'mutants/acceptance-regressions.json':(data_io.jdumps(regressions)+'\n').encode(),
                   'mutants/core-fallback.json':(data_io.jdumps(changed.out['core.json'])+'\n').encode(),
                   'mutants/feed-changed.json':(data_io.jdumps(altered_feed.out['feed.json'])+'\n').encode(),
                   'mutants/feed-changed.xml':altered_feed.texts['feed.xml'].encode(),
                   'mutants/search-changed.json':(data_io.jdumps(altered_search.out['search-index.json'])+'\n').encode(),
                   'mutants/search-edge.json':(data_io.jdumps(edge.out['search-index.json'])+'\n').encode(),
                   'mutants/search-row-semantics.json':(data_io.jdumps(sample_rows.rows)+'\n').encode(),
                   'mutants/core-pending.json':(data_io.jdumps(pending_case.out['core.json'])+'\n').encode(),
                   'mutants/feed-pending.json':(data_io.jdumps(pending_case.out['feed.json'])+'\n').encode(),
                   'mutants/glue-core.json':(glue_release/'core.json').read_bytes(),
                   'mutants/glue-search.json':(glue_release/'search-index.json').read_bytes()}
        artifacts.update({f'raw/{name}':b for name,b in raw.items()}); artifacts.update({f'final/{name}':b for name,b in final.items()})
        for name,b in artifacts.items():
            path=HERE/name
            if args.check:
                assert path.read_bytes()==b, 'oracle mismatch: '+name
            else:
                path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(b)
        # Independent XML parser validates structure, ordered item fields and decoded links.
        def xml_semantics(blob):
            root = ET.fromstring(blob)
            def tree(node): return (node.tag, sorted(node.attrib.items()), node.text or '', [tree(c) for c in node])
            return tree(root)
        assert xml_semantics(final['feed.xml']) == xml_semantics((HERE/'published/feed.xml').read_bytes())
        assert len(ET.fromstring(raw['feed.xml']).findall('./channel/item')) == min(30, len(ctx.out['feed.json']['events']))
        for name in OUTPUTS:
            if name.endswith('.json'):
                assert json.loads(final[name]) == jload(HERE/'published'/name), 'published mismatch: '+name
                print('PUBLISHED MATCH:', name)
            else:
                assert final[name] == (HERE/'published'/name).read_bytes(), 'published mismatch: '+name
                print('PUBLISHED MATCH:', name)
if __name__=='__main__': main()
