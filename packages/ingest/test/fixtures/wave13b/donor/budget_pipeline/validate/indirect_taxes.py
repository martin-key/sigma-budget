"""Active source comparisons for D26 and source-exact measure excerpts."""
import datetime as dt
from functools import lru_cache
import hashlib
import json
from pathlib import Path
from budget_pipeline.validate.checks import Check, DATA, ROOT, load
from budget_pipeline.extract import indirect_tax_evidence as evidence


@lru_cache(maxsize=2)
def raw_evidence(root, fingerprints):
    # Hashes are part of the key: a mutated original cannot reuse an earlier extraction.
    return evidence.extract(Path(root))


def expected_values(c):
    root = Path(ROOT)
    frozen = json.loads((root/evidence.OUTPUT).read_text())
    pins = {line.split('  ', 1)[1]:line.split('  ', 1)[0] for line in (root/'data/originals.sha256').read_text().splitlines() if line.strip()}
    c.ok(frozen.get('schema') == 'indirect-tax-evidence/1', 'independent evidence contract')
    c.ok(hashlib.sha256((root/evidence.OUTPUT).read_bytes()).hexdigest() == pins.get(evidence.OUTPUT), 'independent evidence pin')
    c.ok(set(frozen['sources']) == set(evidence.FILES), 'independent evidence source inventory')
    fingerprints = []
    for name, path in evidence.FILES.items():
        record = frozen['sources'].get(name, {})
        c.ok(record.get('path') == path and record.get('sha256') == pins.get(path), 'independent evidence source pin: '+name)
        if (root/path).is_file():
            digest = hashlib.sha256((root/path).read_bytes()).hexdigest()
            c.ok(digest == record.get('sha256'), 'raw evidence pin: '+name)
            fingerprints.append((path, digest))
    if len(fingerprints) == len(evidence.FILES):
        actual = raw_evidence(str(root), tuple(fingerprints))
        c.ok(actual == frozen, 'independent re-extraction differs from frozen evidence')
        return actual
    c.fact('raw evidence unavailable: comparing against the pinned independent extraction')
    return frozen


def check(ctx):
    c = Check('INDIRECT')
    d = load('indirect-tax-parameters.json')
    try:
        expected = expected_values(c)
    except (ValueError, KeyError, OSError) as error:
        c.fail('cannot verify official indirect-tax evidence: '+str(error))
        return c
    c.ok(set(d) == {'meta','vat','fuels','cigarettes','references'}, 'D26 top-level contract')
    c.ok(d['meta']['status'] == 'real' and set(d['meta']['source']) == {'ec-oil','excise-law','customs-excise-law','nsi-pack','bill'}, 'D26 provenance')
    vat = d.get('vat', {})
    for field in ('standardPct', 'reducedPct'):
        c.near(vat.get(field), expected['vat'][field], 1e-10, 'VAT source value: '+field)
    untaxed = vat.get('untaxed', {})
    c.ok('zeroPct' not in vat and untaxed.get('kind') == 'definition' and untaxed.get('label') == 'без ДДС / 0 %'
         and str(untaxed.get('basis', '')).startswith('ЗДДС') and bool(untaxed.get('note')), 'untaxed bucket is a definition with a legal basis, not an extracted rate')
    c.fact('VAT: standard and reduced rates independently verified; без ДДС / 0 % is a calculation category by definition')
    c.ok(vat.get('unit') == expected['vat']['unit'] and vat.get('standardSince') == expected['vat']['standardSince'], 'VAT unit and validity')
    c.ok(vat.get('source') == ['ec-oil','bill'] and bool(vat.get('reducedQuote')), 'VAT sources and reduced-rate evidence')
    c.ok(set(d.get('fuels', {})) == set(expected['fuels']), 'fuel coverage excludes LPG')
    for name, source in expected['fuels'].items():
        f = d.get('fuels', {}).get(name, {})
        c.ok(f.get('unit') == 'EUR/l' and f.get('originalUnit') == 'EUR/1000 l', name+': units')
        for field in ('excisePerLitre','originalExcise','pricePerLitre','originalPrice'):
            c.near(f.get(field), source[field], 1e-10, name+': independently extracted '+field)
        c.ok(f.get('priceDate') == source['priceDate'] and f.get('validFrom') == source['validFrom'], name+': dates from source')
        c.ok(f.get('source') == f.get('priceSource') == 'ec-oil', name+': EC sources')
        legal = f.get('legalEvidence', {})
        c.ok(legal.get('source') == 'customs-excise-law' and bool(legal.get('quote')), name+': statutory source')
        c.near(legal.get('originalBgnPer1000'), source['originalBgnPer1000'], 0, name+': statutory BGN coefficient')
        c.near(legal.get('conversionRate'), source['conversionRate'], 0, name+': fixed conversion rate')
    schedule = d.get('cigarettes')
    official = expected['cigarettes']
    c.ok(isinstance(schedule, list) and len(schedule) == len(official), 'cigarette schedule must cover every promulgated period')
    if isinstance(schedule, list):
        for i, source in enumerate(official):
            row = schedule[i] if i < len(schedule) and isinstance(schedule[i], dict) else {}
            c.ok(row.get('validFrom') == source['validFrom'], 'cigarette period start and order '+str(i))
            c.ok(row.get('validTo') == source.get('validTo') and ('validTo' in row) == ('validTo' in source), 'cigarette contiguous period end '+str(i))
            c.ok(row.get('source') == 'excise-law' and row.get('unit') == 'EUR/1000 sticks', 'cigarette statutory source and units '+str(i))
            for field in ('specificPer1000','adValoremPct','minimumPer1000'):
                c.near(row.get(field), source[field], 1e-10, 'cigarette source coefficient '+str(i)+': '+field)
    pack = d.get('references', {}).get('pack', {})
    c.ok(pack.get('source') == 'nsi-pack' and pack.get('period') == expected['pack']['period'] and pack.get('originalUnit') == 'BGN/pack' and pack.get('unit') == 'EUR/pack', 'historical pack source, year and units')
    for field in ('originalValue','priceEur','conversionRate'):
        c.near(pack.get(field), expected['pack'][field], 1e-10, 'independent NSI reference: '+field)
    c.ok(pack.get('yearHeaders') == expected['pack']['yearHeaders'], 'NSI year column evidence')
    for name in ('measure-labels','tax-assumptions'):
        c.ok(not (Path(DATA)/'mock'/(name+'.json')).exists(), 'retired file '+name)
    measures = load('measures.json')['items']
    counts = [len(measures),0,0]
    for it in measures:
        counts[1] += bool(it.get('since') or it.get('sinceText'))
        counts[2] += bool(it.get('legal'))
        for f in ('since','sinceText','legal'):
            if f not in it: continue
            ev=it.get('excerptEvidence',{}).get(f,{})
            candidates=[(it.get('quote',''),it['page']), (it.get('context',{}).get('quote',''),it.get('context',{}).get('page'))]
            c.ok(ev.get('source')=='bill' and bool(ev.get('quote')) and any(ev.get('quote','') in q and ev.get('page')==p for q,p in candidates), it['id']+': '+f+' source evidence')
            c.ok(it[f] == (it.get('from') if f=='since' else ev.get('quote')), it['id']+': '+f+' value')
    c.ok(counts==[52,16,14], 'M06 reconciliation: '+str(counts))
    c.fact('M06: 52 ids, 16 date/phrase records, 14 legal records; D26: 2 fuels, 3 cigarette periods')
    return c

GROUPS=[('INDIRECT',check,'Sourced indirect taxes and measure excerpts')]
