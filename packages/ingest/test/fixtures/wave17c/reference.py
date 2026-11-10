#!/usr/bin/env python3
"""Independent reference values captured from the unchanged Python search engine."""
import hashlib, json, os, struct, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'corpus/pipeline'))
from budget_pipeline.validate import search_feed as s, checks
queries=['ДДС','данък върху добавената стойност','МВР вътрешните работи','и в за','а б','и Пловдив','данък '*12,'😀'*119+'МВР','😀'*118+'МВР','Obrazovanie','полиция','ПЕНСИИ','дълг','длъг','МВР град','тайна','таина','равен','ΣΣ','İSTANBUL','\u1c89\u1c8a','А\u0315\u0300','１２３','a\x1cb']
entries=[
 ['institutions','Министерство на вътрешните работи','','полиция','Проект 2027','123 млн. €','real','#/mvr'],
 ['institutions','МВР','','','','','mock','#/mock'],
 ['indicators','Държавен дълг','','','2027','22 млрд. €','real','#/debt'],
 ['municipalities','Община Пловдив','','','','','real','#/plovdiv'],
 ['terms','Данък върху добавената стойност','','','','','real','#/dds'],
 ['terms','Образование и наука','','','','','real','#/school'],
 ['terms','Дълги пенсии','','','','','real','#/pension'],
 ['terms','МВР град','','','','','real','#/phrase'],
 ['terms','тайна','','','','','mock','#/secret'],
 ['terms','равен','','','','10 млн. €','real','#/tie-first'],
 ['terms','равен','','','','10 млн. €','real','#/tie-second'],
]
es=[s.entry(*a) for a in entries]
def tok(q):
 t=s.parse(q); return {'words':list(t),'phrase':t.phrase}
def result(q, only=False):
 hits,hidden,fuzzy=s.run(es,s.parse(q),only); return {'hits':[e['href'] for e in hits], 'hidden':hidden,'fuzzy':fuzzy}
digest=hashlib.sha256()
for cp in range(0x110000):
    normalized=s.norm(chr(cp))
    digest.update(struct.pack('>II',cp,len(normalized)))
    for ch in normalized: digest.update(struct.pack('>I',ord(ch)))
malformed=[]
for raw in ['{"items":','{','{"x":1,}','[1,]','{"x" 1}','{"x":NaN}','[1 2]','"abc','"\\x"','["😀",\n]']:
    try: json.loads(raw,parse_constant=checks._no_constants)
    except Exception as e: malformed.append({'raw':raw,'error':type(e).__name__+': '+str(e)})
case={'malformed':malformed,'unicodeSinglesSha256':digest.hexdigest(), 'entries':entries,'queries':[{'raw':q,'norm':s.norm(q),'lat':s.lat(s.norm(q)),'tokens':tok(q),'scores':[[s.score(e,s.parse(q),False),s.score(e,s.parse(q),True)] for e in es], 'results':result(q),'real':result(q,True)} for q in queries],
      'osa':[{'a':a,'b':b,'max':mx,'distance':s.osa(a,b,mx)} for a,b,mx in [('дълг','длъг',1),('abcdef','abcedf',1),('abc','xyz',1),('пловдив','пловдива',1),('😀а','а😀',1),('дълг','дъл',1)]],
      'magnitudes':[(v,s.mag(v)) for v in ['12 млн. €','1 234,5 млрд. €','−1 млн. €','١٢ млн. €','',None]]}
text=json.dumps(case,ensure_ascii=False,indent=2)+'\n'; target=HERE/'reference.json'
if '--check' in sys.argv:
 if target.read_text(encoding='utf-8') != text: raise SystemExit('search reference differs')
else: target.write_text(text,encoding='utf-8')
print('Verified %d reference queries' % len(queries))
