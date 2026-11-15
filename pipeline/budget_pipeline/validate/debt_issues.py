"""Published debt snapshot contract, independent of the production extractor."""
import math
import re
from datetime import date

def valid_debt_issues(d):
    def num(n): return type(n) is int and n > 0 and n < 2**53
    def iso(s):
        try: return type(s) is str and date.fromisoformat(s).isoformat() == s
        except ValueError: return False
    def isin(s):
        if not isinstance(s,str) or not re.fullmatch(r'(BG|XS)[A-Z0-9]{9}\d',s): return False
        ds=''.join(str(ord(c)-55) if c.isalpha() else c for c in s)
        return sum((int(c)*2//10+int(c)*2%10) if i%2 else int(c) for i,c in enumerate(ds[::-1]))%10==0
    if not isinstance(d,dict) or d.get('schema')!='debt-issues/1' or not isinstance(d.get('meta'),dict) or d.get('meta',{}).get('id')!='D38' or d['meta'].get('status')!='real' or d['meta'].get('mock') is not False or d['meta'].get('asOf')!='2026-09-30': return False
    if not re.fullmatch('[a-f0-9]{64}',str(d.get('sourceSha256',''))) or d.get('sourceUrl')!='https://www.minfin.bg/upload/65462/Bulletin_GovDebt_09-2026_bg.pdf': return False
    ids=[]
    for key,count in [('domestic',13),('external',17)]:
        rows=d.get(key)
        if not isinstance(rows,list) or len(rows)!=count: return False
        for r in rows:
            if not isinstance(r,dict) or r.get('currency') not in ('EUR','USD') or not num(r.get('nominal')) or not iso(r.get('issueDate')) or not iso(r.get('maturity')) or r['maturity']<=r['issueDate']: return False
            if key=='domestic' and (r['currency']!='EUR' or not isinstance(r.get('originalMaturity'),str) or not all(type(r.get(k)) in (int,float) and math.isfinite(r[k]) for k in ('coupon','price','coverage','yield')) or not all(num(r.get(k)) for k in ('offered','bids'))): return False
            values=[r.get('isin')] if key=='domestic' else r.get('isins')
            if not isinstance(values,list) or not values or not all(isin(v) for v in values): return False
            ids.extend(values)
    auctions=d.get('auctions')
    if len(set(ids))!=31 or len(ids)!=31 or not isinstance(auctions,list) or len(auctions)!=12: return False
    if any(not isinstance(r,dict) or not isin(r.get('isin')) or not iso(r.get('date')) or not all(num(r.get(k)) for k in ('offered','bids','approved')) or r['approved']>r['offered'] for r in auctions): return False
    if len({(r['isin'],r['date']) for r in auctions})!=12: return False
    for r in auctions:
        if not all(iso(r.get(k)) for k in ('settlement','issueDate','maturity')) or r['maturity']<=r['issueDate'] or not all(type(r.get(k)) in (int,float) and math.isfinite(r[k]) for k in ('coupon','price','yield','coverage')): return False
    buckets=d.get('maturity')
    if not isinstance(buckets,list) or len(buckets)!=4: return False
    for i,r in enumerate(buckets):
        if not isinstance(r,dict) or not isinstance(r.get('label'),str) or not num(r.get('residualTenths')) or r['residualTenths']>1000: return False
        if (i==0 and 'originalTenths' in r) or (i>0 and (not num(r.get('originalTenths')) or r['originalTenths']>1000)): return False
    if not isinstance(d.get('stock'),dict) or not all(num(d['stock'].get(k)) for k in ('domestic','external')): return False
    if not isinstance(d.get('differences'),dict) or any(type(v) is not int for v in d['differences'].values()): return False
    if not isinstance(d.get('limitations'),list) or not all(isinstance(t,str) for t in d['limitations']): return False
    v=d.get('validation')
    contract = isinstance(v,list) and len(v)==2 and all(isinstance(r,dict) and r.get('outcome')=='неизпълнимо' and all(isinstance(r.get(k),str) for k in ('check','reason')) for r in v)

    if not contract: return False
    from budget_pipeline.validate.debt_cells import verify_debt_cells
    return verify_debt_cells(d)
