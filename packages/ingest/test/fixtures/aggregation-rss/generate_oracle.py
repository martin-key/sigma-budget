#!/usr/bin/env python3
"""Isolated Python 3.12 RSS donor oracle; never reads live release or sources."""
import argparse
import hashlib
import importlib.util
import json
import sys
import types
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DONOR_HASH = '2e3a11cc4aa4424470141ba027172b5fda9910f8de8431da054a8e89466e66ed'
BASELINE = '10697d0def6ff6892029a311e2b590602e66b931'

def load_donor():
    path = ROOT / 'donor/feed.py'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == DONOR_HASH, 'donor hash mismatch'
    # rss uses only BUILD_DATE and stdlib. Stub the other imported roles so no
    # ambient pipeline modules, data roots or metadata can be consulted.
    for name in ('budget_pipeline', 'budget_pipeline.build'):
        mod = types.ModuleType(name)
        mod.__path__ = []
        sys.modules[name] = mod
    for name, attrs in {
        'budget_pipeline.build.definitions': ['PENDING_DEFS', 'POPULATION_ASOF', 'fmt_date', 'fmt_eur', 'fmt_money', 'fmt_num', 'fmt_pct', 'month_name'],
        'budget_pipeline.build.fiscal': ['population_latest'],
        'budget_pipeline.build.data_io': ['BUILD_DATE', 'jsonstat_series', 'meta'],
    }.items():
        mod = types.ModuleType(name)
        for attr in attrs:
            setattr(mod, attr, '2026-11-08' if attr == 'BUILD_DATE' else None)
        sys.modules[name] = mod
    spec = importlib.util.spec_from_file_location('frozen_feed', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def semantics(xml):
    root = ET.fromstring(xml)
    def walk(e):
        return [e.tag, sorted(e.attrib.items()), e.text or '', [walk(c) for c in e]]
    return walk(root)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--compare', help='Compare a candidate XML file semantically to the named frozen case')
    ap.add_argument('--case', default='escaping')
    args = ap.parse_args()
    assert sys.version_info[:2] == (3, 12), 'Python 3.12 required'
    donor = load_donor()
    cases_path = ROOT / 'cases.json'
    assert hashlib.sha256(cases_path.read_bytes()).hexdigest() == '82e3f36f7408efcca7e4657bc5bc0c896825a27e55cde9e37d87218e9931337e', 'case hash mismatch'
    cases = json.loads(cases_path.read_text(encoding='utf8'))
    for name, case in cases.items():
        actual = donor.rss(case['feed'], case['base'])
        parsed = semantics(actual)
        result = {'baseline': BASELINE, 'donorSha256': DONOR_HASH, 'xml': actual, 'semantics': parsed}
        expected = json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n'
        target = ROOT / 'oracle' / (name + '.json')
        if args.check:
            assert target.read_text(encoding='utf8') == expected, name + ' oracle mismatch'
        else:
            target.parent.mkdir(exist_ok=True)
            target.write_text(expected, encoding='utf8')
    if args.compare:
        case = cases[args.case]
        assert semantics(Path(args.compare).read_text(encoding='utf8')) == semantics(donor.rss(case['feed'], case['base'])), 'XML semantic mismatch'
    print('RSS donor and independent XML parsing verified:', ', '.join(cases))

if __name__ == '__main__':
    main()
