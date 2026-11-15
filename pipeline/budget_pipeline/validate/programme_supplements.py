"""Independent PDFMiner decoding of the SHA-bound programme cell positions.

Positions contain geometry only; expected amounts are always read from PDF bytes.
No imports from the generator or the frozen builders.
"""
import hashlib,json,re,sys
from pathlib import Path
from decimal import Decimal
from functools import lru_cache
ROOT=Path(__file__).resolve().parents[3]
POSITIONS=ROOT/'packages/dataset-schema/src/programme-positions.json'

def name(s):
    s=re.sub(r'\s+',' ',s).strip()
    s=re.sub(r'^\d{4}\.[\d.\s]*?(?=[А-Яа-я])','',s)
    return re.sub(r'-\s+','-',re.sub('["„“”]','',s)).strip()

def read_sources(root=ROOT):
    import pdfplumber
    from pdfplumber.utils import extract_text
    result={}
    for code,spec in json.loads(POSITIONS.read_text()).items():
        file=Path(root)/'data/originals/program_budgets'/spec['file']
        if hashlib.sha256(file.read_bytes()).hexdigest()!=spec['sourceSha256']:raise ValueError('Programme source pin')
        rows=[]
        with pdfplumber.open(file) as doc:
            for pos in spec['positions']:
                p=doc.pages[pos['page']-1]
                def text(box):
                    a,b,c,d=box
                    chars=[x for x in p.chars if a<=(x['x0']+x['x1'])/2<c and b<=(x['top']+x['bottom'])/2<d]
                    return extract_text(chars) or ''
                label=text(pos['labelBox']); nm=name(label)
                m=re.search(r'\d{4}\.\d{2}\.\d{2}',re.sub(r'\s','',text(pos['codeBox']))) if pos.get('codeBox') else None
                kind='total' if nm.startswith('Общо') else 'program' if re.match(r'^(Бюджетна програма|Програма )',nm) else 'policy'
                if not m and kind=='program' and not re.match(r'Програма \d+',nm):raise ValueError('Missing source identifier '+code+'/'+str(pos['page'])+'/'+str(len(rows)))
                printed=m[0] if m else 'total' if kind=='total' else ' '.join(nm.split()[:3]) if kind=='policy' else re.match(r'Програма \d+',nm)[0]
                vals=[]
                for box in pos['cells']:
                    raw=re.sub(r'\s','',text(box))
                    if not raw: vals.append(None);continue
                    if not re.fullmatch(r'-?\d+[.,]\d',raw):raise ValueError('Independent programme cell is not numeric')
                    vals.append(float(Decimal(raw.replace(',','.'))))
                rows.append(dict(page=pos['page'],printedCode=printed,kind=kind,name=nm,values=vals))
        result[code]=dict(code=code,file=spec['file'],sourceSha256=spec['sourceSha256'],rows=rows)
    return result


def projection(source):
    policies=[]; parent=None; ordinal=0
    for row in source['rows'][1:]:
        if source['code']=='0100':
            if row['kind']=='policy': ordinal+=1
            suffix='00' if row['kind']=='policy' else '%02d'%int(re.search(r'\d+$',row['printedCode'])[0])
            code='%s.%02d.%s'%(source['code'],ordinal,suffix)
        else: code=source['code']+row['printedCode'][4:]
        node=dict(code=code,name=row['name'],kind=row['kind'],printedCode=row['printedCode'],values={'2026':list(row['values'])})
        if row['kind']=='policy':
            node['programs']=[];policies.append(node);parent=node
        elif parent is not None and (source['code']=='0100' or code[:7]==parent['code'][:7]):parent['programs'].append(node)
        else:policies.append(node);parent=None
    return dict(total={'2026':list(source['rows'][0]['values'])},policies=policies)

def accounting(source):
    differences={};unavailable=[]
    def check(key,total,parts):
        if total is None or None in parts:unavailable.append(key);return
        delta=int(Decimal(str(total))*10)-sum(int(Decimal(str(x))*10) for x in parts)
        if delta:differences[key]=delta
    for i,r in enumerate(source['rows']):
        v=r['values']
        for j in (0,3,6):check('row/%d/split/%d'%(i,j),v[j],v[j+1:j+3])
        for j in range(3):check('row/%d/sectors/%d'%(i,j),v[j],[v[j+3],v[j+6]])
    policies=projection(source)['policies']
    for p in policies:
        if p['kind']=='policy':
            for j in range(9):check('policy/%s/%d'%(p['code'],j),p['values']['2026'][j],[n['values']['2026'][j] for n in p['programs']])
    for j in range(9):check('total/%d'%j,source['rows'][0]['values'][j],[p['values']['2026'][j] for p in policies])
    check('programmes/prb',source['rows'][0]['values'][1],[r['values'][1] for r in source['rows'] if r['kind']=='program'])
    return dict(differences=differences,unavailable=unavailable)

def same_cells(a,b):
    """JSON numbers may be int/float; booleans never stand in for printed zero/one."""
    import math
    if isinstance(a,bool) or isinstance(b,bool):return type(a) is type(b) and a==b
    if isinstance(a,(int,float)) and isinstance(b,(int,float)):return math.isfinite(a) and math.isfinite(b) and a==b
    if isinstance(a,dict) and isinstance(b,dict):return set(a)==set(b) and all(same_cells(a[k],b[k]) for k in a)
    if isinstance(a,list) and isinstance(b,list):return len(a)==len(b) and all(same_cells(x,y) for x,y in zip(a,b))
    return type(a) is type(b) and a==b

@lru_cache(maxsize=4)
def registered_notes(code):
    import yaml
    registry=yaml.safe_load((ROOT/'data/datasets.yaml').read_text())
    row=next(x for x in registry['datasets'] if x['id']=='ministries-programs')
    prefix=code+': '
    return tuple(note[len(prefix):] for note in row['limitations'] if note.startswith(prefix))

def validate_envelope(document,source):
    import math
    keys='meta id art name short tier years yearLabels vintage cols policiesKind total policies yearsComplete check skipped skippedTotal doc sourceContract sourceAudit accounting notes'.split()
    if not isinstance(document,dict) or set(document)!=set(keys):raise ValueError('Programme document keys')
    meta=document.get('meta')
    if not isinstance(meta,dict) or meta.get('id')!='D09' or meta.get('unit')!='хил. €' or meta.get('status')!='real' or meta.get('mock') is not False or not same_cells(meta.get('source'),['prb']):raise ValueError('Programme metadata')
    if not all(isinstance(meta.get(k),str) and meta[k] for k in ('title','sourceNote','asOf','retrieved')) or not all(re.fullmatch(r'\d{4}-\d{2}-\d{2}',meta[k]) for k in ('asOf','retrieved')):raise ValueError('Programme metadata text/date')
    if isinstance(document.get('art'),bool) or not isinstance(document.get('art'),(int,float)) or not math.isfinite(document['art']) or not all(isinstance(document.get(k),str) and document[k] for k in ('name','short','policiesKind')):raise ValueError('Programme agency fields')
    labels=['Отчет 2023','Отчет 2024','Закон 2025','Прогноза 2026' if source['code']=='7400' else 'Проект 2026','Прогноза 2027','Прогноза 2028']
    vintage=['actual','actual','plan','forecast' if source['code']=='7400' else 'plan','forecast','forecast']
    cols=['consTotal','consPrb','consOther','deptTotal','deptPrb','deptOther','admTotal','admPrb','admOther']
    expected=dict(years=[2023,2024,2025,2026,2027,2028],yearLabels=labels,vintage=vintage,cols=cols,skipped=[],skippedTotal=0,notes=list(registered_notes(source['code'])))
    if any(not same_cells(document.get(k),v) for k,v in expected.items()):raise ValueError('Programme labels, notes or skipped cells')
    doc=document.get('doc');pages=list(dict.fromkeys(row['page'] for row in source['rows']))
    if not isinstance(doc,dict) or set(doc)!=set('file pages pagesByYear archive archiveUrl'.split()) or doc.get('file')!=source['file'] or doc.get('archiveUrl')!='https://www.parliament.bg/bills/52/52-602-01-19.zip' or not isinstance(doc.get('archive'),str):raise ValueError('Programme document origin')
    if not same_cells(doc.get('pages'),pages) or not same_cells(doc.get('pagesByYear'),{'2026':pages}):raise ValueError('Programme source pages')

def validate_document(document,source):
    """Each published cell is matched to fresh PDFMiner source decoding, not the producer."""
    validate_envelope(document,source)
    if document.get('sourceContract')!='programme-supplement/1' or document.get('id')!=source['code']:raise ValueError('Programme source contract')
    if not same_cells(document.get('sourceAudit'),dict(sourceSha256=source['sourceSha256'],rows=source['rows'])):raise ValueError('Programme source cells')
    expected=projection(source)
    if any(not same_cells(document.get(k),v) for k,v in expected.items()):raise ValueError('Programme published cells')
    observed=accounting(source)
    registry=json.loads((ROOT/'packages/dataset-schema/src/programme-differences.json').read_text())
    if not same_cells(observed['differences'],registry[source['sourceSha256']]['differences']) or not same_cells(document.get('accounting'),observed):raise ValueError('Programme exact source differences')
    if document.get('yearsComplete')!=[2026] or document.get('tier')!='source-verified':raise ValueError('Programme coverage')
    check=document.get('check',{})
    if not isinstance(check,dict) or isinstance(check.get('zdbExp'),bool) or not isinstance(check.get('zdbExp'),(int,float)):raise ValueError('Programme law total type')
    if not same_cells(check,dict(prbTotal2026=source['rows'][0]['values'][1],zdbExp=check.get('zdbExp'),matchesLaw=check.get('zdbExp')==source['rows'][0]['values'][1],sourceDifferences=len(observed['differences']),unavailableChecks=len(observed['unavailable']))):raise ValueError('Programme check results')
    return True

@lru_cache(maxsize=1)
def source_references():
    return read_sources()

def valid_supplement(document):
    if not isinstance(document,dict) or document.get('sourceContract')!='programme-supplement/1':return False
    try:
        source=source_references()[document['id']]
        return validate_document(document,source)
    except (ValueError,KeyError,TypeError,AttributeError):return False

def counts(ctx):
    import budget_pipeline.validate.checks as L
    m=ctx.get('ministries.json')
    if not isinstance(m,dict) or not isinstance(m.get('items'),list) or not any(isinstance(x,dict) and isinstance(x.get('programs'),dict) and x['programs'].get('tier')=='source-verified' for x in m['items']):return dict(budgets=0,policies=0,programs=0,differ=0)
    documents=[ctx.get('ministries/'+code+'.json') for code in json.loads(POSITIONS.read_text()) if L.exists('ministries/'+code+'.json')]
    valid=[d for d in documents if valid_supplement(d)]
    return dict(budgets=len(valid),differ=sum(not d["check"]["matchesLaw"] for d in valid),policies=sum(sum(p['kind']=='policy' for p in d['policies']) for d in valid),programs=sum(sum(r['kind']=='program' for r in d['sourceAudit']['rows']) for d in valid))

def has_supplements(ctx):return counts(ctx)['budgets']==len(json.loads(POSITIONS.read_text()))

if __name__=='__main__':
    print(json.dumps(read_sources(),ensure_ascii=False,indent=2))
