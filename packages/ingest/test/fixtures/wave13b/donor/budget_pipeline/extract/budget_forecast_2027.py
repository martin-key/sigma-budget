#!/usr/bin/env python3
"""Extract the pinned 2027 MF forecast PDF directly from its ZIP, without DOCX.

Coordinates select columns relative to discovered year headers; captions select
pages. Output retains printed cells (including blanks and textual assumptions).
Validation is fail-closed: an inconsistent source still produces an inspectable
JSON with failed checks, and the command exits 1. No builders are run.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile
import tempfile
from budget_pipeline.build.forecast_tables import REVENUE, EXPENDITURE, SUM_RULES

import pymupdf

from budget_pipeline.build.data_io import ROOT, RAW as ORIGINALS, SRC, jload
RAW = ORIGINALS / 'budget_2027'
OUT = SRC / 'budget_forecast_2027.json'
MEMBER = 'ZDBRB-2027/4-UMTBF-2027-2029-motivi.pdf'
NUMBER = re.compile(r'^[−-]?\s*\d+(?:\s+\d{3})*(?:,\d+)?%?$')



def number(s):
    s = re.sub(r'\s', '', s).replace('−', '-').replace('%', '')
    return float(s.replace(',', '.')) if NUMBER.fullmatch(s) else None


def spans(page):
    out = []
    for b in page.get_text('rawdict')['blocks']:
        for line in b.get('lines', []):
            for s in line['spans']:
                chars=s['chars']
                text=''.join(c['c'] for c in chars)
                for m in re.finditer(r'\S(?:.*?\S)?(?=\s{2,}|\s*$)',text):
                    part=chars[m.start():m.end()]
                    t=m.group().strip()
                    monetary=list(re.finditer(r'[−-]?\d+(?:\s+\d{3})*,\d+%?',m.group()))
                    if len(monetary)>1 and not re.sub(r'[−-]?\d+(?:\s+\d{3})*,\d+%?','',m.group()).strip():
                        for token in monetary:
                            pc=part[token.start():token.end()]
                            out.append({'text':token.group(),'x':(pc[0]['bbox'][0]+pc[-1]['bbox'][2])/2,
                                        'x0':pc[0]['bbox'][0],'bold':bool(s['flags'] & 16),
                                        'y':(s['bbox'][1]+s['bbox'][3])/2})
                        continue
                    if t and t!=str(page.number+1) and not (s['flags'] & 1 and t.isdigit()):
                        out.append({'text':t,'x':(part[0]['bbox'][0]+part[-1]['bbox'][2])/2,
                                    'x0':part[0]['bbox'][0], 'bold':bool(s['flags'] & 16), 'y':(s['bbox'][1]+s['bbox'][3])/2})
    return out


def locate(doc, caption):
    hits = [p.number for p in doc if caption in p.get_text() and p.number > 4]
    if len(hits) != 1:
        raise ValueError(f'caption {caption!r}: {hits}')
    return hits[0]


def columns(sp, years, after=0):
    candidates = [s for s in sp if s['text'] == str(years[0]) or s['text'] == f'{years[0]} г.']
    candidates = [s for s in candidates if s['y'] > after]
    if not candidates:
        raise ValueError(f'no year header {years}')
    y = min(s['y'] for s in candidates)
    heads = sorted([s for s in sp if abs(s['y']-y)<3 and re.fullmatch(r'202\d(?: г\.)?', s['text'])], key=lambda s:s['x'])
    return heads


def extract_rows(page, heads, ymin, ymax, label_edge, unit='млн. €', text_cells=False):
    sp = [s for s in spans(page) if ymin < s['y'] < ymax]
    centers = [h['x'] for h in heads]
    data = [s.copy() for s in sp if s['x0'] > label_edge]
    for s in data:
        s['col'] = min(range(len(centers)), key=lambda i:abs(s['x']-centers[i]))
    if text_cells:
        data=[s for s in data if s['x0']>400]
        # Assumption paragraphs are separated by a larger leading than wrapped
        # lines. Numbered and dash-led paragraphs explicitly start a new row.
        labels = sorted([s for s in sp if 84 < s['x0'] < 330],key=lambda s:(s['y'],s['x']))
        starts=[s['y'] for s in sp if s['x0']<85 and re.fullmatch(r'\d+(?:\.\d+)*\.',s['text'])]
        starts += [s['y'] for s in labels if s['text'].startswith('- ')]
        starts=sorted(max((s['y'] for s in labels if y-9<=s['y']<=y+1),default=y) for y in starts)
        groups=[]
        for s in labels:
            if not groups or any(groups[-1][-1]['y']+1 < y <= s['y']+1 for y in starts):
                groups.append([])
            groups[-1].append(s)
        # Most labels are top-aligned. On p.183 four labels are vertically
        # centered against six-line dated rates; account for that geometry.
        bounds=[g[0]['y']-2 for g in groups]
        if page.number+1==183:
            for i,g in enumerate(groups):
                label=' '.join(s['text'] for s in g)
                if label.startswith(('Акциз на течност','Акциз на нагреваемо изделие')):
                    bounds[i]-=23
                elif label.startswith(('- съдържащ никотин до','- съдържащ никотин над')):
                    bounds[i]-=29
        rows=[]
        if data and min(s['y'] for s in data)<bounds[0]:
            # A page begins with a value-cell continuation and no label text.
            cells=[[s for s in data if s['col']==k and s['y']<bounds[0]] for k in range(len(heads))]
            row=make_row(page,'(continued)',cells,unit)
            row['continuation']=True
            row['band']=[ymin,bounds[0]]
            rows.append(row)
        for i,g in enumerate(groups):
            lo=bounds[i]
            hi=bounds[i+1] if i+1<len(groups) else ymax
            cells=[[s for s in data if s['col']==k and lo<=s['y']<hi] for k in range(len(heads))]
            row=make_row(page,' '.join(s['text'] for s in g),cells,unit)
            row['band']=[round(lo,2),round(hi,2)]
            row['continuation']=not any(abs(y-g[0]['y'])<2 for y in starts)
            codes=[t['text'].rstrip('.') for t in sp if t['x0']<85
                   and re.fullmatch(r'\d+(?:\.\d+)*\.',t['text'])
                   and abs(t['y']-g[0]['y'])<9]
            row['source_no']=codes[0] if codes else None
            rows.append(row)
        return rows
    # Join a wrapped thousands prefix only where the same column contains a
    # decimal suffix on the next line. Never interpret missing cells as zero.
    used = set()
    for i,s in enumerate(data):
        if re.fullmatch(r'\d{1,2}',s['text']):
            nxt = [ (j,t) for j,t in enumerate(data) if t['col']==s['col'] and 2<t['y']-s['y']<13 and re.fullmatch(r'\d{3},\d+', t['text'])]
            if len(nxt)==1:
                j,t=nxt[0]; t['text']=s['text']+' '+t['text']; used.add(i)
    data=[s for i,s in enumerate(data) if i not in used and (number(s['text']) is not None or s['text']=='-' or ' г. и ' in s['text'])]
    groups=[]
    for s in sorted(data,key=lambda s:(s['y'],s['x'])):
        if not groups or s['y']-groups[-1][0]['y']>3:
            groups.append([])
        groups[-1].append(s)
    labels=[s for s in sp if s['x0']<=label_edge]
    ignored={'млн. евро','млн. eвро','Брутен вътрешен продукт','Пазар на труда и цени','Платежен баланс','Паричен сектор'}
    rows=[]
    for i,g in enumerate(groups):
        y=sum(s['y'] for s in g)/len(g)
        lo=ymin if not i else (groups[i-1][0]['y']+g[0]['y'])/2
        hi=ymax if i+1==len(groups) else (g[0]['y']+groups[i+1][0]['y'])/2
        lab=' '.join(s['text'] for s in sorted(labels,key=lambda s:(s['y'],s['x'])) if lo<=s['y']<hi and s['text'] not in ignored)
        cells=[[s for s in g if s['col']==k] for k in range(len(heads))]
        rows.append(make_row(page,lab,cells,unit))
    return rows


def make_row(page,label,cells,unit):
    printed=[' '.join(s['text'] for s in sorted(c,key=lambda s:(s['y'],s['x']))) or None for c in cells]
    return {'label':label,'page':page.number+1,'y':round(min((s['y'] for c in cells for s in c),default=0),2),'printed':printed,
            'values':[number(t) if t else None for t in printed],
            'units':['% от БВП' if t and t.endswith('%') and unit!='%' else unit for t in printed]}


def year_columns(heads, unit):
    return [{'year':int(h['text'][:4]), 'unit':unit} for h in heads]


def extract(doc):
    tables={}
    for key,caption,years,unit,edge in [
        ('I_2','Табл. I-2:',list(range(2024,2030)),'row-specific',260),
        ('II_1','Табл. II-1:',list(range(2025,2030)),'млн. €',295),
        ('II_2','Табл. II-2:',list(range(2025,2030)),'млн. €',295),
        ('II_3','Табл. II-3:',list(range(2025,2030)),'млн. €',295),
        ('II_5','Табл. II-5:',list(range(2026,2030)),'млн. €',165),
        ('III_1','Табл. III-1:',list(range(2026,2030)),'млн. €',215),
        ('VI_1','Табл. VI-1:',list(range(2025,2030)),'млн. €',215),
        ('VI_2','Табл. VI-2:',list(range(2025,2030)),'%',245)]:
        p=doc[locate(doc,caption)]; sp=spans(p)
        cy=p.search_for(caption)[0].y0
        heads=columns(sp,years,cy)
        hy=max(s['y'] for s in heads)
        end=min([s['y'] for s in sp if s['y']>hy and (s['text'].startswith('Източник:') or s['text'].startswith('Забележка:'))]+[p.rect.height-35])
        # Header vintages end before the first numeric body row.
        start=hy+19 if key not in ('I_2',) else hy+8
        if key=='II_5':
            # Four value/growth pairs, discovered from the growth headers.
            # Value/growth pairs are centred either side of the year header.
            heads=[dict(h,x=h['x']+dx) for h in heads for dx in (-21,24)]
            start=hy+25
            end=min(end, min(s['y'] for s in sp if 'Поради закръгление' in s['text']))
        rows=extract_rows(p,heads,start,end,edge,unit)
        if key=='II_5':
            labs=sorted([s for s in sp if s['x0']<edge and start<s['y']<end],key=lambda s:s['y'])
            groups=[]
            for s in labs:
                if re.match(r'^\d+[ab]?\.',s['text']): groups.append([])
                if groups: groups[-1].append(s['text'])
            if len(groups)!=len(rows): raise ValueError('ESA row labels')
            for r,g in zip(rows,groups): r['label']=' '.join(x for x in g if not x.isdigit())

        if key=='III_1':
            labs=sorted([s for s in sp if s['x0']<=edge and start<s['y']<end],key=lambda s:s['y'])
            groups=[]
            for s in labs:
                if not groups or s['text'].startswith('- ') or (s['bold'] and (not groups[-1][-1]['bold'] or s['y']-groups[-1][-1]['y']>10)):
                    groups.append([])
                groups[-1].append(s)
            if len(groups)!=len(rows): raise ValueError(f'function labels {len(groups)} != {len(rows)}')
            for r,g in zip(rows,groups): r['label']=' '.join(s['text'] for s in g)
        cols=year_columns([h for h in heads if h['text'].startswith('202')],unit)
        if key=='I_2':
            for r in rows: r['units']=['млн. €' if 'млн.' in r['label'] else ('% от БВП' if '% от БВП' in r['label'] else '%')]*len(heads)
        if key=='II_5':
            for i,c in enumerate(cols):
                if i%2: c.update(unit='%',measure='annual_change_or_gdp_share')
        if key=='II_5':
            for i,r in enumerate(rows):
                r['units']=['млн. €' if j%2==0 else ('%' if i<20 else '% от БВП') for j in range(8)]
        if key=='III_1':
            for i,c in enumerate(cols): c['unit']='млн. €' if i<4 else '% от БВП'
        tables[key]={'caption':caption,'pages':[p.number+1],'columns':cols,'rows':rows}
    for annex in [1,2,3,4]:
        begin=locate(doc,f'ПРИЛОЖЕНИЕ № {annex}:')
        end=locate(doc,f'ПРИЛОЖЕНИЕ № {annex+1}:')
        if annex==1:
            for section,year,date in [('execution2025',2025,'31.12.2025'),('execution2026',2026,'30.09.2026')]:
                pages=[i for i in range(begin,end) if f'Отчет {date}' in doc[i].get_text()]
                rows=[]
                for i in pages:
                    p=doc[i];sp=spans(p)
                    headers=sorted([s for s in sp if s['text'].startswith('к.')],key=lambda s:s['x'])
                    heads=headers[1:]
                    if len(heads)!=5: raise ValueError('Annex 1 headers')
                    hy=max(s['y'] for s in heads)
                    stop=min([s['y'] for s in sp if s['y']>hy and s['text'].startswith('*')]+[p.rect.height-75])
                    rows+=extract_rows(p,heads,hy+6,stop,390,'млн. €')
                cols=[{'year':year,'vintage':v,'unit':u,'scope':scope} for v,u,scope in [
                    ('закон','млн. €','КФП'),('отчет','млн. €','КФП'),('отчет','млн. €','национален бюджет'),
                    ('отчет','млн. €','ЕС'),('отчет','% от закона','КФП')]]
                tables[f'annex1_{section}']={'caption':'ПРИЛОЖЕНИЕ № 1:','pages':[i+1 for i in pages],'columns':cols,'rows':rows}
        if annex==3:
            for suffix,offset,unit in [('mln',0,'млн. €'),('pct_gdp',2,'% от БВП')]:
                rows=[]
                for i in range(begin+offset,begin+offset+2):
                    p=doc[i];sp=spans(p);heads=columns(sp,list(range(2025,2030)))
                    hy=heads[0]['y']; stop=min([s['y'] for s in sp if s['text'].startswith('Забележка:')]+[p.rect.height-35])
                    rows+=extract_rows(p,heads,hy+22,stop,450,unit)
                tables[f'annex3_{suffix}']={'caption':'ПРИЛОЖЕНИЕ № 3:','pages':[begin+offset+1,begin+offset+2],'columns':year_columns(heads,unit),'rows':rows}
        if annex in (2,4):
            headings=[]
            rows=[]; unit='row-specific' if annex==2 else 'хил. €'
            for i in range(begin,end):
                p=doc[i];sp=spans(p);heads=columns(sp,list(range(2026 if annex==2 else 2027,2030)))
                hy=heads[0]['y']; stop=min([s['y'] for s in sp if s['text'].startswith('* Забележка:')]+[p.rect.height-65])
                pr=extract_rows(p,heads,hy+(34 if annex==2 else 8),stop,400 if annex==2 else 450,unit,text_cells=annex==2)
                if annex==2:
                    for row in pr:
                        row['fragments']=[{'page':row['page'],'band':row['band'],'printed':row['printed'][:]}]
                    for r in pr:
                        r['unit_cell']=unit_cell(p,r['y']) if any(r['printed']) else None
                    headings.extend(r for r in pr if not r.get('continuation'))
                    pr=[r for r in pr if any(r['printed'])]
                if annex==2 and pr and pr[0].get('continuation') and rows:
                    continuation=pr.pop(0)
                    previous=rows[-1]
                    previous['label']+=(' '+continuation['label']) if continuation['label']!='(continued)' else ''
                    previous.setdefault('continuation_pages',[]).append(continuation['page'])
                    previous['fragments']+=continuation['fragments']
                    for c,t in enumerate(continuation['printed']):
                        if t:
                            previous['printed'][c]=((previous['printed'][c] or '')+' '+t).strip()
                            previous['values'][c]=number(previous['printed'][c])
                rows+=pr
            tables[f'annex{annex}']={'headings':headings if annex==2 else [],'caption':f'ПРИЛОЖЕНИЕ № {annex}:','pages':list(range(begin+1,end+1)),'columns':year_columns(heads,unit),'rows':rows}
    tables['annex1_execution2026']['note']='Програма: разчети към ЗДБРБ 2026; printed percentages compare September execution with this law. The estimate discussion is prose, preserved in page_text.'
    # Preserve the complete coordinate layer as well as the cell interpretation
    # for Annex 2: several assumptions span pages or contain multiple dated rates.
    tables['annex2']['page_spans']=[{'page':i+1,'spans':spans(doc[i])} for i in range(locate(doc,'ПРИЛОЖЕНИЕ № 2:'),locate(doc,'ПРИЛОЖЕНИЕ № 3:'))]
    annotate_annex2(tables['annex2'])
    tables['annex2']['parse_note']='Year-header columns and paragraph bands (centered labels on p.183 handled explicitly); dated rates and page continuations retained. Fragment cells checked internally across rawdict and words.'
    tables['annex3_pct_gdp']['rows'][-1]['units']=['млн. €']*5
    tables.update(extract_remaining(doc))
    apply_vintages(doc,tables)
    return tables


def validate(tables):
    """Rounding bound is half a last printed digit per operand and result.

    Currency amounts have one decimal; ratios one decimal percentage point.
    Only the exact documented GDP discrepancy is accepted; other conflicts fail.
    """
    checks=[]
    def check(name,ok,**detail):
        checks.append(dict(name=name,passed=bool(ok),**detail))
    def close(name,actual,expected,tolerance):
        check(name,abs(actual-expected)<=tolerance+1e-8,actual=actual,expected=expected,tolerance=tolerance)
    counts={'I_2':(16,6),'II_1':(15,5),'II_2':(17,5),'II_3':(10,5),'II_5':(25,8),'III_1':(32,8),
            'VI_1':(6,5),'VI_2':(19,5),'annex1_execution2025':(18,5),'annex1_execution2026':(18,5),
            'annex3_mln':(63,5),'annex3_pct_gdp':(64,5),'annex4':(50,3),'annex2':(100,4)}
    for key,(nr,nc) in counts.items():
        t=tables[key]
        check(key+' shape',len(t['rows'])==nr and len(t['columns'])==nc and all(len(r['values'])==nc and r['label'] for r in t['rows']))
    for i,r in enumerate(tables['annex2']['rows']):
        for c in range(4):
            parts=[f['printed'][c] for f in r['fragments'] if f['printed'][c]]
            printed=' '.join(parts) or None
            check(f'Annex2 fragment alignment {i}/{c}',r['printed'][c]==printed and r['values'][c]==(number(printed) if printed else None))
    checks.extend(validate_annex2(tables['annex2']))
    checks.extend(validate_remaining(tables))
    checks.extend(validate_metadata(tables))
    def values(key,index): return tables[key]['rows'][index]['values']
    anchors=[('I_2',0,[104767,116018,130459,141302,150819,160013]),
        ('II_1',0,[44016.4,49615.3,51065.2,53963.3,56927.2]),
        ('II_1',5,[47508.7,56807.2,55972.1,58692.2,60805.7]),
        ('II_1',11,[-3492.2,-7191.9,-4907.0,-4728.8,-3878.4]),
        ('VI_1',0,[31428.9,37699.0,44343.9,50657.3,56747.8])]
    for key,i,expected in anchors: check(f'{key} anchor {i}',values(key,i)==expected,expected=expected,actual=values(key,i))
    def identity(key,total,parts,columns=None):
        for c in columns or range(len(tables[key]['columns'])):
            a=values(key,total)[c]; vv=[]
            for p in parts:
                v=values(key,p)[c]
                # The shared hierarchy omits these explicitly blank cells.
                # Assert the exact blank locations instead of coercing any null.
                if key=='annex3_mln' and (p,c) in {(20,2),(20,3),(20,4),(54,0)}:
                    check(f'Annex3 structural blank {p}/{c}',v is None and tables[key]['rows'][p]['printed'][c] is None)
                    continue
                vv.append(v)
            check(f'{key} numeric {total}/{c}',a is not None and all(v is not None for v in vv))
            if a is not None and all(v is not None for v in vv): close(f'{key} sum {total}/{c}',sum(vv),a,0.05*(len(vv)+1))
    for key in ['II_1','II_2']:
        for total,parts in [(0,[2,3,4]),(5,[7,10]),(7,[8,9])]: identity(key,total,parts)
    identity('VI_1',0,[2,4])
    for total,parts in [(0,[1,2,3]),(4,list(range(5,10))),(12,[13,14,15]),(16,[17,18]),(19,[20,21,22,23]),(24,list(range(25,31)))]: identity('III_1',total,parts,range(4))
    for c in range(5): close(f'II_1 revenue-expenditure {2025+c}',values('II_1',0)[c]-values('II_1',5)[c],values('II_1',11)[c],0.15)
    for c in range(5):
        for main,national,eu in [(0,0,0),(5,5,2),(11,13,6),(13,15,8)]:
            close(f'CFP national+EU {main}/{2025+c}',values('II_2',national)[c]+values('II_3',eu)[c],values('II_1',main)[c],0.15)
        for key,expense,transfer,balance in [('II_2',5,11,13),('II_3',2,4,6)]:
            close(f'{key} revenue-expenditure+transfer {2025+c}',values(key,0)[c]-values(key,expense)[c]+values(key,transfer)[c],values(key,balance)[c],0.2)
        for a,b in [(0,4),(4,8),(8,10),(10,14),(14,18)]:
            parts=[values('VI_2',i)[c] for i in range(a,b)]
            # A dash denotes no lev-denominated debt after euro adoption.
            parts=[0 if v is None and tables['VI_2']['rows'][a+i]['printed'][c]=='-' else v for i,v in enumerate(parts)]
            check(f'VI_2 numeric {a}/{c}',all(v is not None for v in parts))
            if all(v is not None for v in parts): close(f'VI_2 shares {a}/{c}',sum(parts),100,0.05*(len(parts)+1))
    # Every repeated amount/percentage in the overview must occur, unchanged,
    # in the full Annex 3. Labels disambiguate identical value vectors in tests.
    for i,r in enumerate(tables['II_1']['rows']):
        key='annex3_pct_gdp' if r['printed'][0].endswith('%') else 'annex3_mln'
        check(f'II_1 vs {key} row {i}',r['values'] in [a['values'] for a in tables[key]['rows']])
    # Ratios use the GDP printed locally in Annex 3.
    gdp=values('annex3_pct_gdp',63)
    for i,(a,p) in enumerate(zip(tables['annex3_mln']['rows'],tables['annex3_pct_gdp']['rows'])):
        check(f'Annex3 paired label {i}',a['label']==p['label'])
        for c,(v,pct) in enumerate(zip(a['values'],p['values'])):
            check(f'Annex3 blank pattern {i}/{c}',(v is None)==(pct is None))
            if v is not None and pct is not None: close(f'Annex3 GDP local {i}/{2025+c}',v/gdp[c]*100,pct,0.0501)
    spec=REVENUE+EXPENDITURE
    indices={rid:i for i,(rid,*_) in enumerate(spec)}
    for i,(rid,label,*_) in enumerate(spec):
        check('Annex3 hierarchy label '+rid,tables['annex3_mln']['rows'][i]['label']==label)
    # The hierarchy omits four explicitly blank cells, verified below.
    for parent,kids in SUM_RULES.items():
        identity('annex3_mln',indices[parent],[indices[k] for k in kids])
    for c in range(5):
        close(f'Annex3 balance {2025+c}',values('annex3_mln',0)[c]-values('annex3_mln',31)[c],values('annex3_mln',61)[c],0.15)
        close(f'Annex3 financing {2025+c}',values('annex3_mln',61)[c]+values('annex3_mln',62)[c],0,0.1)
        close(f'Annex3 noninterest {2025+c}',values('annex3_mln',32)[c]-values('annex3_mln',57)[c],values('annex3_mln',33)[c],0.15)
    for c in range(4):
        close(f'ESA revenue-expenditure {2026+c}',values('II_5',20)[c*2]-values('II_5',21)[c*2],values('II_5',22)[c*2],0.15)
        for i,r in enumerate(tables['III_1']['rows']): close(f'functions GDP {i}/{2026+c}',r['values'][c]/gdp[c+1]*100,r['values'][c+4],0.0501)
    for key in ['annex1_execution2025','annex1_execution2026']:
        for r in tables[key]['rows']:
            if r['printed'][-1] and r['printed'][-1].endswith('%'): r['units'][-1]='% от закона'
    fiscal_gdp=values('annex3_pct_gdp',63)
    gdp=values('I_2',0)[1:]
    for c in range(5):
        if c==0:
            check('GDP I-2 vs Annex3 2025 known discrepancy',
                  gdp[c]==116018 and fiscal_gdp[c]==116548.5,
                  pages=[27,194], source_discrepancy=True,
                  actual=gdp[c],expected=fiscal_gdp[c],
                  reason='2025 GDP differs between I-2 and Annex 3; ratios use the GDP printed in their own table.')
        else:
            close(f'GDP I-2 vs Annex3 {2025+c}',gdp[c],fiscal_gdp[c],0.55)
    for key in ['annex1_execution2025','annex1_execution2026']:
        for i,r in enumerate(tables[key]['rows']):
            law,actual,national,eu,pct=r['values']
            if actual is not None and national is not None and eu is not None: close(f'{key} national+EU {i}',national+eu,actual,0.15)
            if law and actual is not None and pct is not None: close(f'{key} percent law {i}',actual/law*100,pct,0.05+100*(0.05/abs(law)+abs(actual)*0.05/(abs(law)*(abs(law)-0.05))))
    return checks


def check_representations(doc,tables):
    """Three spaced row samples per table via words, against rawdict.

    Match the complete printed numeric token on its physical baseline.
    Every table must supply three successful samples; absence fails closed.
    """
    samples=[]
    for key,table in tables.items():
        candidates=[]
        for row in table['rows']:
            if row.get('continuation_pages'): continue
            for col,(printed,value) in enumerate(zip(row['printed'],row['values'])):
                if value is not None and printed:
                    candidates.append((row,col,printed,value))
                    break
        selected=[candidates[i] for i in (0,len(candidates)//2,len(candidates)-1)]
        for row,col,printed,value in selected:
            words=doc[row['page']-1].get_text('words')
            baseline=[w for w in words if abs((w[1]+w[3])/2-row['y'])<3]
            text=' '.join(w[4] for w in sorted(baseline,key=lambda w:w[0]))
            pattern=r'(?<![\d,])'+r'\s*'.join(re.escape(t) for t in printed.replace('−','-').split())+r'(?![\d,])'
            if not re.search(pattern,text.replace('−','-')):
                raise ValueError(f"words verification {key} page {row['page']}: {printed!r} absent at baseline {row['y']}")
            samples.append(dict(table=key,page=row['page'],row=row['label'],column=col,
                                printed=printed,value=value,y=row['y']))
    annex_cells=0
    for row in tables['annex2']['rows']:
        for fragment in row['fragments']:
            page=doc[fragment['page']-1]
            heads=columns(spans(page),list(range(2026,2030)))
            for c,printed in enumerate(fragment['printed']):
                words=[w for w in page.get_text('words')
                       if fragment['band'][0] <= (w[1]+w[3])/2 < fragment['band'][1]
                       and (w[0]+w[2])/2>400
                       and min(range(4),key=lambda k:abs((w[0]+w[2])/2-heads[k]['x']))==c]
                text=' '.join(w[4] for w in sorted(words,key=lambda w:(round((w[1]+w[3])/4),w[0])))
                norm=lambda t:re.sub(r'\s','',t or '').replace('−','-')
                if norm(text)!=norm(printed):
                    raise ValueError(f"Annex2 words page {fragment['page']} col {c}: {text!r} != {printed!r}")
                annex_cells+=1
    return {'annex2_fragment_cells_matched':annex_cells,
            'method':'Internal PyMuPDF rawdict/words comparison: first, middle and last numeric rows of the original 14 table views, plus all Annex 2 fragment cells by year and vertical band',

            'samples':samples,'matched':len(samples),'mismatches':0}


# The source draws merged unit cells independently of the label/value rows.
def unit_cell(page, y):
    cache=page.parent.__dict__.setdefault('_budget_unit_cells',{})
    if page.number not in cache:
        cache[page.number]=[c for t in page.find_tables().tables for c in t.cells]
    candidates = {tuple(c) for c in cache[page.number]
                  if c and c[0] < 365 < c[2] and 325 < c[0] < 335
                  and c[2] < 410 and c[1] <= y < c[3]}
    if len(candidates) != 1:
        raise ValueError(f'unit cell p{page.number+1}, y={y}: {candidates}')
    box = next(iter(candidates))
    return {'page': page.number+1, 'bbox': list(box),
            'text': ' '.join(page.get_textbox(pymupdf.Rect(box)).split()) or None}


def annotate_annex2(table):
    """Retain numbered headings, including those without numeric cells."""
    contexts = {}
    current = None
    counters = {}
    for h in table['headings']:
        no = h['source_no']
        if no:
            parent = no.rsplit('.',1)[0] if '.' in no else None
            current = no
            h['source_id'] = no
            h['parent_context'] = ([{'source_id':parent,'label':contexts[parent]['label']}]
                                   if parent else [])
            contexts[no] = h
        else:
            if current is None:
                raise ValueError('Annex2 child without parent')
            counters[current] = counters.get(current,0)+1
            h['source_id'] = f'{current}/item{counters[current]}'
            chain = contexts[current]['parent_context']
            h['parent_context'] = chain + [{'source_id':current,'label':contexts[current]['label']}]
        h['semantic_label'] = ' / '.join([x['label'] for x in h['parent_context']]+[h['label']])
    # Most rows share the enclosing unit cell. The contribution group 11 has
    # an explicitly printed '%' across the page break, shared by its subrows.
    group11 = next(h['unit_cell'] for h in table['headings']
                   if h.get('source_no')=='11.1' and h.get('unit_cell') and h['unit_cell']['text'])
    contexts['11']['unit_evidence']=dict(group11,parent_source_id='11')
    contexts['11']['units']=['%']*4
    for r in table['rows']:
        cell = r['unit_cell']
        if cell and cell['text'] is None and r.get('source_no','') and r['source_no'].startswith('11.'):
            cell = dict(group11,parent_source_id='11')
        r['unit_evidence'] = cell
        r['units'] = [cell['text'] if cell else None]*4
    # These are evidence assertions, read again by validate() to reject
    # semantic mutations as well as changes in counts.
    table['source_semantics'] = [
        {k:r[k] for k in ('source_id','source_no','label','parent_context','semantic_label','units')}
        for r in table['rows']]
    table['source_semantics'] = json.loads(json.dumps(table['source_semantics'],ensure_ascii=False))


def validate_annex2(table):
    checks=[]
    rows=table['rows']
    expected=table['source_semantics']
    ids=[r.get('source_id') for r in rows]
    checks.append(dict(name='Annex2 unique source identities',passed=len(ids)==len(set(ids)) and all(ids)))
    checks.append(dict(name='Annex2 source semantics count',passed=len(rows)==len(expected)))
    headings={h['source_id']:h for h in table['headings']}
    for i,(r,e) in enumerate(zip(rows,expected)):
        checks.append(dict(name=f'Annex2 heading ownership {i}',passed=
            r['source_id'] in headings and headings[r['source_id']]['label']==r['label']
            and all(p['source_id'] in headings and headings[p['source_id']]['label']==p['label'] for p in r['parent_context'])))
        for field in ('source_id','source_no','label','parent_context','semantic_label','units'):
            checks.append(dict(name=f'Annex2 source {field} {i}',passed=r.get(field)==e[field],page=r['page']))
    return checks


ORIGINAL_KEYS = {'I_2','II_1','II_2','II_3','II_5','III_1','VI_1','VI_2',
                 'annex1_execution2025','annex1_execution2026','annex2',
                 'annex3_mln','annex3_pct_gdp','annex4'}


def source_inventory(doc):
    numbered = re.findall(r'Табл\.\s*([IVX]+-\d+):',doc[3].get_text())
    annexes=[]
    for page in doc:
        if page.number<5: continue
        for m in re.finditer(r'ПРИЛОЖЕНИЕ №\s*(\d+):',page.get_text()):
            annexes.append({'id':f'annex{m[1]}','page':page.number+1})
    if len(numbered)!=23 or len(annexes)!=10:
        raise ValueError('source table/annex inventory changed')
    return {'numbered_tables':[n.replace('-','_') for n in numbered],'annexes':annexes}


def validate_inventory(tables,inventory):
    checks=[]
    for key in inventory['numbered_tables']:
        checks.append(dict(name='inventory '+key,passed=key in tables and bool(tables[key].get('rows'))))
    for a in inventory['annexes']:
        key=a['id']
        checks.append(dict(name='inventory '+key,passed=any(k==key or k.startswith(key+'_') for k in tables)))
    return checks


def extract_remaining(doc):
    """Column schemas retain provider/scope dimensions as well as year."""
    out={}
    # (id, pages, first year, unit, label edge). Body bounds come from headers
    # and source footers, with explicit continuation pages.
    configs=[
        ('I_1',[26],2024,'row-specific',290),
        ('I_3',[32],2025,'%',260),('I_4',[32],2025,'%',260),
        ('II_4',[38],2026,'row-specific',280),
        ('II_6',[43,44],2026,'млн. €',160),
        ('II_7',[47,48,49],2027,'млн. €',370),
        ('II_8',[50],2027,'млн. €',370),
        ('II_9',[51],2025,'% от БВП',185),
        ('III_2',[89],2026,'млн. €',300),
        ('IV_1',[136],2027,'хил. €',245),
        ('V_1',[142],2027,'млн. €',310),('V_2',[142],2027,'млн. €',310),
        ('VII_1',[159],None,'%',280),
        ('VII_2',[162],2026,'row-specific',310),
        ('VII_3',[163],2026,'row-specific',280),
        ('annex5',[197],2027,'хил. €',500),
        ('annex6',[197],2027,'хил. €',500),
        ('annex7',[198],2027,'хил. €',250),
        ('annex8',[199],2027,'хил. €',250),
        ('annex9',[200],2027,'хил. €',500),
        ('annex10',[201],2025,'хил. €',500),
    ]
    for key,pages,first,unit,edge in configs:
        rows=[]; cols=None
        scenario_headers=[]
        for j,pn in enumerate(pages):
            p=doc[pn-1]; sp=spans(p)
            caption=(f"ПРИЛОЖЕНИЕ № {key[5:]}:" if key.startswith('annex')
                     else 'Табл. '+key.replace('_','-')+':')
            cy=p.search_for(caption)[0].y1 if j==0 else 0
            if key=='VII_1':
                heads=[dict(s,text='2027') for s in sp if s['text'] in ('S1','S2')]
                hy=max(s['y'] for s in heads)
                cols=[{'provider':provider,'indicator':ind,'unit':'%'}
                      for provider in ('МФ','ЕК') for ind in ('S1','S2')]
            else:
                heads=columns(sp,[first],cy); hy=max(s['y'] for s in heads)
                if key in ('I_4','II_9'):
                    provider_heads=sorted([s for s in sp if hy<s['y']<hy+25 and s['text'] in ('МФ','ЕК')],key=lambda s:s['x'])
                    if key=='I_4': heads=[heads[0]]+provider_heads
                    else: heads=provider_heads
                    years=[2025,2026,2026,2027,2027]
                    cols=[{'year':y,'provider':('МФ' if c%2==1 or c==0 else 'ЕК'),'unit':unit} for c,y in enumerate(years)]
                    hy=max(s['y'] for s in heads)
                elif key=='II_6':
                    heads=[dict(h,x=h['x']+dx) for h in heads for dx in (-22,22)]
                    header_cells=[[] for _ in heads]
                    for token in sp:
                        if hy+3<token['y']<hy+50 and token['x0']>160:
                            c=min(range(8),key=lambda c:abs(token['x']-heads[c]['x']))
                            header_cells[c].append(token)
                    printed=[' '.join(s['text'] for s in sorted(cell,key=lambda s:s['y'])) for cell in header_cells]
                    if printed!=['Базисен сценарий','Изменение спрямо основния сценарий, %']*4:
                        raise ValueError(f'II_6 p{pn}: scenario header changed: {printed}')
                    scenario_headers.append({'page':pn,'printed':printed})
                    hy+=40
                    cols=[{'year':first+c//2,'measure':'baseline' if c%2==0 else MAIN_SCENARIO_DIFFERENCE,'unit':'млн. €' if c%2==0 else '%'} for c in range(8)]
                elif key=='IV_1':
                    # Three 2027 columns: total, local and delegated activities.
                    detail=sorted([s for s in sp if abs(s['y']-hy)<4 and s['text'] in ('местни','делегирани')],key=lambda s:s['x'])
                    heads=[heads[0]]+detail+heads[1:]
                    cols=[{'year':y,'scope':scope,'unit':unit} for y,scope in [(2027,'total'),(2027,'local'),(2027,'delegated'),(2028,'total'),(2029,'total')]]
                elif key in ('annex7','annex8'):
                    # Printed к.2,2.1,2.2 etc give the nine actual columns.
                    codes=['2','2.1','2.2','3','3.1','3.2','4','4.1','4.2']
                    candidates=[s for s in sp if s['text']=='2.1' and s['y']>hy]
                    chy=min(s['y'] for s in candidates)
                    heads=sorted([s for s in sp if abs(s['y']-chy)<3 and s['text'] in codes],key=lambda s:s['x'])
                    hy=chy
                    cols=[{'year':2027+c//3,'measure':('net','expenditure','transfer')[c%3],'unit':unit} for c in range(9)]
                else: cols=year_columns(heads,unit)
            stop=min([s['y'] for s in sp if s['y']>hy+4 and s['text'].startswith(('Източник:','Забележка:','ПРИЛОЖЕНИЕ №'))]+[p.rect.height-35])
            # One table can share its page with the following table.
            other_caps=[r.y0 for r in p.search_for('Табл.') if r.y0>hy+4]
            if other_caps: stop=min(stop,min(other_caps))
            start=hy+5
            if key=='II_9': start=hy+16
            if key=='annex10': start=hy+22
            pr=extract_rows(p,heads,start,stop,edge,unit)
            if key=='II_9' and len(pr)==6:
                # The 2025 investment cell is on the first label line,
                # the other years on the second line of the same source row.
                a,b=pr[1:3]
                for c,t in enumerate(b['printed']):
                    if t is not None:
                        if a['printed'][c] is not None: raise ValueError('overlapping investment cells')
                        a['printed'][c]=t; a['values'][c]=b['values'][c]
                pr.pop(2)
            repair_labels(p,pr,edge,start,stop)
            if key in ('annex6','annex7','annex8'):
                repair_annex_labels(p,pr,edge,start,stop)
            if key=='II_4':
                pr[0]['label']='Препоръка на Съвета / '+pr[0]['label']
                pr[1]['label']='Отчетни данни/прогноза / '+pr[1]['label']
            for r in pr:
                r['units']=[col['unit'] for col in cols]
                if unit=='row-specific':
                    if key=='VII_3' and r['label'] in (
                            'Потребление','Брутообразуване на основен капитал',
                            'Износ на стоки и услуги','Внос на стоки и услуги'):
                        r['parent_label']=pr[1]['label']
                        r['units']=[label_unit(pr[1]['label'])]*len(cols)
                    else:
                        r['units']=[label_unit(r['label'])]*len(cols)
                if key=='II_6' and r['label'].startswith(('17.','18.')):
                    r['units']=['млн. €' if c%2==0 else '% от БВП' for c in range(8)]
                    r['measures']=['baseline' if c%2==0 else 'gdp_share_pct' for c in range(8)]
            if key=='annex10':
                pr[-1]['units']=['% от БВП']*2
            rows+=pr
        out[key]={'caption':caption,'pages':pages,'columns':cols,'rows':rows}
        if key=='II_6':
            out[key]['scenario_headers']=scenario_headers
            share_headers=sorted([s for s in sp if s['text']=='% от БВП'],key=lambda s:s['x'])
            if len(share_headers)!=4:
                raise ValueError('II_6 GDP-share subheader changed')
            out[key]['gdp_share_headers']={'page':pn,'printed':[s['text'] for s in share_headers]}
    return out


def label_unit(label):
    if 'пр.п.' in label:
        return 'пр.п.'
    if '% от БВП' in label:
        return '% от БВП'
    if '%' in label:
        return '%'
    if label.startswith('Валутен курс '):
        return label.removeprefix('Валутен курс ')
    units=re.findall(r'\(([^()]+)\)',label)
    if not units:
        raise ValueError(f'no source unit in {label!r}')
    return units[-1]


def repair_labels(page,rows,edge,start,stop):
    """Read complete label paragraphs from PDF blocks, not numeric midpoints."""
    for r in rows:
        candidates=[]
        for b in page.get_text('dict')['blocks']:
            if not b.get('lines') or not b['bbox'][1]-3<=r['y']<=b['bbox'][3]+3:
                continue
            lines=[]
            for line in b['lines']:
                left=[s['text'].strip() for s in line['spans'] if s['bbox'][0]<=edge]
                if left and start<(line['bbox'][1]+line['bbox'][3])/2<stop:
                    lines.append((line['bbox'][1],line['bbox'][3],' '.join(left)))
            if lines:candidates.append(lines)
        if candidates:
            # Prefer the paragraph whose vertical extent encloses this row.
            lines=min(candidates,key=lambda ls:abs((ls[0][0]+ls[-1][1])/2-r['y']))
            enclosed=[a for a in rows if lines[0][0]-3<=a['y']<=lines[-1][1]+3]
            if len(enclosed)>1:
                pos=enclosed.index(r)
                lo=(enclosed[pos-1]['y']+r['y'])/2 if pos else start
                hi=(enclosed[pos+1]['y']+r['y'])/2 if pos+1<len(enclosed) else stop
                lines=[l for l in lines if lo<=(l[0]+l[1])/2<hi]
            r['label']=' '.join(l[2] for l in lines).strip()


def repair_annex_labels(page,rows,edge,start,stop):
    # These annexes have numbered labels whose top lines precede centered
    # numeric baselines. Numbered starts define ownership of all wrapped lines.
    labels=[s for s in spans(page) if s['x0']<edge and start<s['y']<stop]
    starts=sorted(s['y'] for s in labels if re.match(r'^\d+(?:\.\d+)*(?:\s|$)',s['text']))
    # Annex 6 also prints two unnumbered subset rows.
    starts+= [s['y'] for s in labels if s['text'].startswith('в т. ч.')]
    starts=sorted(starts)
    if len(starts)!=len(rows):
        raise ValueError(f'numbered label boundaries p{page.number+1}: {len(starts)} != {len(rows)}')
    for i,r in enumerate(rows):
        lo=starts[i]-1
        hi=starts[i+1]-1 if i+1<len(starts) else stop
        r['label']=' '.join(s['text'] for s in sorted(labels,key=lambda s:(s['y'],s['x'])) if lo<=s['y']<hi)


EXTRA_EXPECTATIONS = {'I_1': (6, 6, [3.3, 3.5, 3.0, 3.4, 3.2, 3.1], [3.3, 2.0, 2.3, 2.5, 2.3, 2.3]),
 'I_3': (2, 5, [3.3, 3.1, 2.8, 2.7, 2.6], [0.4, 0.3, 0.0, -0.2, -0.4]),
 'I_4': (3, 5, [3.1, 3.0, 2.5, 2.5, 2.2], [3.5, 4.8, 4.2, 4.0, 2.6]),
 'II_4': (6, 4, [4.2, 3.4, 3.4, 3.2], [1.8, 0.2, 0.1, 0.1]),
 'II_6': (21,
          8,
          [18674.0, 11.8, 18710.2, -0.7, 19913.3, 2.4, 20805.1, -2.0],
          [57505.6, 44.1, 58689.7, 41.5, 60250.7, 39.9, 62445.3, 39.0]),
 'II_7': (27, 3, [800.0, -800.0, None], [1926.9, -0.1, 660.1]),
 'II_8': (11, 3, [170.5, None, None], [-75.6, None, None]),
 'II_9': (5, 5, [0.8, 0.9, 1.2, 1.1, 1.3], [-4.0, -5.0, -4.1, -4.2, -4.3]),
 'III_2': (5, 4, [2692.8, 3151.0, 3695.1, 4080.3], [78.4, 89.5, 83.5, 84.3]),
 'IV_1': (5,
          5,
          [5162139.3, 465462.3, 4696677.0, 5209111.0, 5278211.0],
          [255000.0, 184704.3, 70295.7, 255000.0, 255000.0]),
 'V_1': (3, 3, [1195.2, 1220.3, 1295.5], [1604.3, 1761.4, 1935.3]),
 'V_2': (3, 3, [17.8, 17.2, 15.5], [25.5, 24.5, 22.2]),
 'VII_1': (5, 4, [2.1, 2.7, 0.7, 1.4], [-1.0, -0.4, -1.0, -0.3]),
 'VII_2': (4, 4, [0.0, -0.1, -0.1, 0.2], [29.9, 8.2, 17.5, 0.0]),
 'VII_3': (15, 4, [0.2, 0.4, 0.6, 0.7], [-0.1, -0.3, -0.6, -0.9]),
 'annex5': (2, 3, [69657.0, 68302.0, 63990.0], [752184.0, 760350.0, 762362.7]),
 'annex6': (10, 3, [51145.9, 51213.4, 51306.9], [46953.5, 47158.9, 47357.0]),
 'annex7': (3,
            9,
            [199036.4, 615744.3, 416707.9, 230728.3, 779153.8, 548425.5, 317511.9, 963975.0, 646463.1],
            [416477.9, 646134.7, 229656.8, 304793.7, 472703.6, 167909.9, 331983.6, 471654.9, 139671.3]),
 'annex8': (5,
            9,
            [29896.2, 47753.4, 17857.2, 29073.6, 47130.8, 18057.2, 29243.6, 47130.8, 17887.2],
            [None, 8672.2, 8672.2, None, 8682.8, 8682.8, None, 8694.2, 8694.2]),
 'annex9': (8, 3, [5162139.3, 5209111.0, 5278211.0], [184704.3, 184704.3, 184704.3]),
 'annex10': (7, 2, [243398.0, 295093.0], [0.75, 0.9])}


def validate_remaining(tables):
    checks=[]
    def check(name,ok,**details):
        checks.append(dict(name=name,passed=bool(ok),**details))
    def close(name,actual,expected,operands):
        tolerance=0.05*(operands+1)
        check(name,abs(actual-expected)<=tolerance+1e-8,actual=actual,expected=expected,tolerance=tolerance)
    for key,(nr,nc,first,last) in EXTRA_EXPECTATIONS.items():
        t=tables.get(key,{})
        rows=t.get('rows',[])
        check(key+' shape',len(rows)==nr and len(t.get('columns',[]))==nc
              and all(len(r['values'])==nc and r['label'] for r in rows))
        if not rows:continue
        check(key+' first anchor',rows[0]['values']==first,page=rows[0]['page'])
        check(key+' last anchor',rows[-1]['values']==last,page=rows[-1]['page'])
    def vals(key,i):return tables[key]['rows'][i]['values']
    def sum_rows(key,total,parts,columns=None):
        for c in columns if columns is not None else range(len(tables[key]['columns'])):
            raw=[vals(key,i)[c] for i in parts]
            # Empty cells in these sparse tables are explicitly printed blanks;
            # they contribute nothing to the source total, never to output data.
            close(f'{key} sum {total}/{c}',sum(v for v in raw if v is not None),vals(key,total)[c],len(parts))
    sum_rows('II_6',1,[2,3],range(0,8,2))
    sum_rows('II_6',7,[0,1,4,6],range(0,8,2))
    sum_rows('II_6',15,list(range(8,15)),range(0,8,2))
    sum_rows('II_6',19,[7,16],range(0,8,2))
    sum_rows('II_6',20,[15,17,18],range(0,8,2))
    sum_rows('II_7',26,list(range(26)))
    sum_rows('II_8',10,list(range(10)),[0])
    for c in range(5):
        close(f'II_9 balance/{c}',vals('II_9',2)[c]-vals('II_9',3)[c],vals('II_9',4)[c],2)
    sum_rows('III_2',0,[1,2,3,4])
    sum_rows('IV_1',0,[1,2,3,4])
    for i in range(5):
        close(f'IV_1 local+delegated/{i}',sum(vals('IV_1',i)[1:3]),vals('IV_1',i)[0],2)
    for key in ('V_1','V_2'):sum_rows(key,2,[0,1])
    sum_rows('VII_1',0,[1,2,3])
    sum_rows('annex6',5,[6,7])
    for key in ('annex7','annex8'):
        for i,r in enumerate(tables[key]['rows']):
            for c in range(0,9,3):
                v=r['values']
                close(f'{key} expenditure-transfer {i}/{c}',
                      (v[c+1] or 0)-(v[c+2] or 0),v[c] or 0,2)
    for total,parts in [(0,[1,2,5]),(2,[3,4]),(5,[6,7])]:
        sum_rows('annex9',total,parts)
    for c in range(2):
        # Annex 10 prints whole thousands, unlike one-decimal amounts elsewhere.
        actual=sum(vals('annex10',i)[c] for i in range(4))
        check(f'annex10 integer total/{c}',abs(actual-vals('annex10',4)[c])<=0.5*5,
              actual=actual,expected=vals('annex10',4)[c],tolerance=0.5*5)
    for c in range(2):
        check(f'annex10 GDP ratio/{c}',abs(vals('annex10',4)[c]/vals('annex10',5)[c]*100-vals('annex10',6)[c])<=0.005)
    return checks


# A vintage is a source heading, never a property of the calendar year.
TABLE_VINTAGES = {
    'I_1': ('отчет', 'отчет', 'прогноза', 'прогноза', 'прогноза', 'прогноза'),
    'I_2': ('отчет', 'отчет', 'прогноза', 'прогноза', 'прогноза', 'прогноза'),
    'II_1': ('отчет', 'очаквано', 'проект', 'прогноза', 'прогноза'),
    'II_2': ('отчет', 'очаквано', 'проект', 'прогноза', 'прогноза'),
    'II_3': ('отчет', 'очаквано', 'проект', 'прогноза', 'прогноза'),
    # The amount/change pair belongs to the same printed year heading.
    'II_5': ('очаквано', 'очаквано', 'проект', 'проект', 'прогноза', 'прогноза', 'прогноза', 'прогноза'),
    'III_1': ('очаквано', 'проект', 'прогноза', 'прогноза') * 2,
    'III_2': ('програма', 'проект', 'прогноза', 'прогноза'),
    # Local/delegated subcolumns inherit the printed 2027 project heading.
    'IV_1': ('проект', 'проект', 'проект', 'прогноза', 'прогноза'),
    'VI_1': ('отчет', 'очаквано', 'проект', 'прогноза', 'прогноза'),
    'VI_2': ('отчет', 'очаквано', 'проект', 'прогноза', 'прогноза'),
    'annex1_execution2025': ('програма', 'отчет', 'отчет', 'отчет', None),
    'annex1_execution2026': ('програма', 'отчет', 'отчет', 'отчет', None),
    'annex3_mln': ('отчет', 'очаквано', 'проект', 'прогноза', 'прогноза'),
    'annex3_pct_gdp': ('отчет', 'очаквано', 'проект', 'прогноза', 'прогноза'),
    'annex10': ('отчет', 'проект'),
}
# Exact printed tokens in left-to-right order; the same assertions run on
# continuation pages. Merged headings can cover several numeric columns.
STATUS_HEADERS = {
    'I_1': ['Отчетни данни', 'Прогноза'],
    'I_2': ['Отчетни данни', 'Прогноза'],
    'II_1': ['Отчет', 'Очакв.', 'Проект', 'Прогноза', 'Прогноза'],
    'II_2': ['Отчет', 'Очакв.', 'Проект', 'Прогноза', 'Прогноза'],
    'II_3': ['Отчет', 'Очакв.', 'Проект', 'Прогноза', 'Прогноза'],
    'II_5': ['Очакв.', 'Проект', 'Прогноза', 'Прогноза'],
    'III_1': ['Очаквано', 'Проект', 'Прогноза', 'Прогноза'] * 2,
    'III_2': ['Програма', 'Проект', 'Прогноза', 'Прогноза'],
    'IV_1': ['Проект', 'Прогноза', 'Прогноза'],
    'VI_1': ['Отчет', 'Очаквано', 'Проект', 'Прогноза', 'Прогноза'],
    'VI_2': ['Отчет', 'Очаквано', 'Проект', 'Прогноза', 'Прогноза'],
    'annex1_execution2025': ['Програма', 'Отчет', 'Програма'],
    'annex1_execution2026': ['Програма', 'Отчет', 'Програма'],
    'annex3_mln': ['Отчет', 'Очаквано', 'Проект', 'Прогноза', 'Прогноза'],
    'annex3_pct_gdp': ['Отчет', 'Очаквано', 'Проект', 'Прогноза', 'Прогноза'],
    'annex10': ['Отчет', 'Проект'],
}
STATUS_TOKEN = re.compile(r'Отчетни данни|Отчет|Очакв\.|Очаквано|Проект|Прогноза|Програма')
MAIN_SCENARIO_DIFFERENCE = 'difference_from_main_scenario_pct'


def apply_vintages(doc, tables):
    """Apply only audited printed statuses and preserve their source evidence."""
    for key, table in tables.items():
        statuses = TABLE_VINTAGES.get(key, (None,) * len(table['columns']))
        if len(statuses) != len(table['columns']):
            raise ValueError(f'{key}: status column count')
        for column, status in zip(table['columns'], statuses):
            column.pop('vintage', None)
            if status is not None:
                column['vintage'] = status
        evidence = []
        for pn in table['pages']:
            page = doc[pn-1]
            sp = spans(page)
            if key.startswith('annex1_'):
                hy = max(s['y'] for s in sp if s['text'].startswith('к.'))
                lo, hi = hy-55, hy-15
            elif 'year' in table['columns'][0]:
                cy = 0
                if not key.startswith('annex3_') and pn == table['pages'][0]:
                    cy = page.search_for(table['caption'])[0].y1
                heads = columns(sp, [table['columns'][0]['year']], cy)
                hy = heads[0]['y']
                lo, hi = hy-25, hy+19
            else:
                # VII-1 has providers and indicators, not year/status columns.
                continue
            tokens = [m.group() for s in sorted(sp, key=lambda s:s['x'])
                      if lo < s['y'] < hi for m in STATUS_TOKEN.finditer(s['text'])]
            expected = STATUS_HEADERS.get(key, [])
            if tokens != expected:
                raise ValueError(f'{key} p{pn}: status headers {tokens!r} != {expected!r}')
            evidence.append({'page': pn, 'band': [lo,hi], 'printed': tokens})
        table['status_headers'] = evidence


def validate_metadata(tables):
    checks = []
    for key, table in tables.items():
        expected = TABLE_VINTAGES.get(key, (None,) * len(table['columns']))
        checks.append(dict(name=key+' printed vintages',
                           passed=[c.get('vintage') for c in table['columns']] == list(expected)))
        checks.append(dict(name=key+' status headers',
                           passed=all(h['printed']==STATUS_HEADERS.get(key, [])
                                      for h in table['status_headers'])))
    table = tables['II_6']
    checks.append(dict(name='II_6 comparison dimension',
                       passed=[c.get('measure') for c in table['columns']] ==
                       ['baseline', MAIN_SCENARIO_DIFFERENCE]*4))
    for header in table['scenario_headers']:
        checks.append(dict(name=f"II_6 printed scenario header p{header['page']}",
                           passed=header['printed']==['Базисен сценарий',
                               'Изменение спрямо основния сценарий, %']*4))
    checks.append(dict(name='II_6 printed GDP-share headers',
                       passed=table['gdp_share_headers']['printed']==['% от БВП']*4))
    for row in table['rows']:
        is_gdp_share = row['label'].startswith(('17.', '18.'))
        expected_measures = ['baseline', 'gdp_share_pct']*4 if is_gdp_share else None
        checks.append(dict(name='II_6 row measure '+row['label'],
                           passed=row.get('measures')==expected_measures))
    return checks


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=OUT);parser.add_argument('--check',action='store_true');args=parser.parse_args()
    acquisition=jload(RAW/'acquisition.json')
    pin=next(x for x in acquisition if x['file']=='ZDBRB-2027.zip')
    archive=(RAW/pin['file']).read_bytes()
    if hashlib.sha256(archive).hexdigest()!=pin['sha256']: raise ValueError('ZIP pin mismatch')
    with zipfile.ZipFile(RAW/pin['file']) as z: pdf=z.read(MEMBER)
    member=next(x for x in pin['members'] if x['name']==MEMBER)
    if hashlib.sha256(pdf).hexdigest()!=member['sha256']: raise ValueError('PDF pin mismatch')
    with pymupdf.open(stream=pdf,filetype='pdf') as doc:
        if len(doc)!=201: raise ValueError('expected 201 PDF pages')
        tables=extract(doc)
        verification=check_representations(doc,{k:v for k,v in tables.items() if k in ORIGINAL_KEYS})
        inventory=source_inventory(doc)
        page_text=[{'page':p.number+1,'text':p.get_text()} for p in doc if 168<=p.number<len(doc)]
    result={'limitations':['Annex 2 mixed/date/formula cells retain printed text; null numeric values do not imply zero. Annex 2 source rows 21 (minimum pension formula) and 23 (pension policy) have blank unit cells, retained as null units. No tables or annexes are excluded.'], 'source':{'archive':str((RAW/pin['file']).relative_to(ROOT)), 'archive_sha256':pin['sha256'],'member':MEMBER,'pdf_sha256':member['sha256'],'pages':201},'tables':tables,'page_text':page_text,'checks':validate(tables)}
    result['cross_representation_checks']=verification
    result['inventory']=inventory
    result['checks']+=validate_inventory(tables,inventory)
    tables['annex2']['parse_status']='checked' if all(c['passed'] for c in result['checks']) and verification['mismatches']==0 else 'failed'
    result['diagnostics']=[c for c in result['checks'] if c.get('source_discrepancy')]
    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            regenerated=Path(tmp)/'forecast.json'
            regenerated.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
            if regenerated.read_bytes()!=args.output.read_bytes():
                print('frozen extraction differs',file=sys.stderr)
                return 1
    else:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
    for diagnostic in result['diagnostics']:
        print('SOURCE DISCREPANCY '+json.dumps(diagnostic,ensure_ascii=False))
    for k,t in tables.items(): print(k,t['pages'],len(t['rows']))
    failed=[c for c in result['checks'] if not c['passed']]
    print(f"{len(result['checks'])-len(failed)}/{len(result['checks'])} checks passed; {len(failed)} failed")
    for c in failed: print(json.dumps(c,ensure_ascii=False),file=sys.stderr)
    return 1 if failed else 0

if __name__=='__main__':
    sys.exit(main())
