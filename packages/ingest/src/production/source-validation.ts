/** Independent source selection around the accepted DEBT/MUNIC/SEBRA rule wrappers.
 * Low-level readers are shared; no dataset builder or produced output supplies expectations. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonstatSeries } from '../io/data.js';
import { parseBnbSdmx,parseEurostatSnapshot } from '../readers/snapshots/index.js';
import { createDebtLocalSourceGroups,type OriginalPin,type SourceAssertion } from '../validate/debt-local-sources.js';
import { Check } from '../validate/checks.js';
import type { Context } from '../validate/context.js';
import type { Group } from '../validate/runner.js';
import type { ExecutionContext } from '../release-build/types.js';
import type { PreparedProduction } from './loader.js';
import { pythonRound } from '../common/format.js';
const ASBP='data/originals/asbp/UMTBF-2026-2028-motivi.pdf',LAW='data/originals/dv/zdb2026_dv69_idMat245041.html',GIS='data/cache/gisco_lau_bg.json',OBLAST='data/cache/eurostat_pop_nuts3_bg.json';
export function productionSourceGroups(context:Readonly<ExecutionContext>,prepared:PreparedProduction):Group<Context>[]{
 const input=prepared.input,read=(p:string)=>readFileSync(join(context.exportRoot,p)).toString('utf8');
 const pin=(paths:string[],source:string):OriginalPin[]=>paths.map(path=>{const fact=context.inputs.find(f=>f.path===path);if(!fact)throw new Error('Independent source pin absent: '+path);return {path,source,sha256:fact.sha256};});
 const assertion=(scope:string,originals:string[],file:string,pointer:string,expected:unknown):SourceAssertion=>({scope,originals,file,pointer,expected});
 const debt:SourceAssertion[]=[];
 for(const [label,key] of [['Държавен дълг, млн. евро','totalMln'],['Държавен дълг/БВП (%)*','pctGdp'],['Външен дълг, млн. евро','externalMln'],['Вътрешен дълг, млн. евро','domesticMln']] as const){const row=input.debt.table.rows.find(r=>r.label===label);if(!row)throw new Error('Independent VI-1 row absent');debt.push(assertion('asbp-zdd',[ASBP],'debt.json','/zdd/'+key,row.values));}
 const gdp=input.debt.table.rows.find(r=>r.label==='БВП, млн. евро');if(!gdp)throw new Error('Independent GDP row absent');debt.push(assertion('gdp-vintages',[ASBP],'debt.json','/zdd/gdpMln',gdp.values));
 const lines=input.debt.pages.find(p=>p.page===144)!.body.split('\n').map(s=>s.trim());
 const at=lines.indexOf('Дълг с матуритет до 1 г.');if(at<0)throw new Error('Independent VI-2 maturity row absent');const maturity=lines.slice(at+1,at+6).map(s=>{if(!/^\d+,\d%$/.test(s))throw new Error('Independent maturity percentage unit');return Number(s.slice(0,-1).replace(',','.'));});debt.push(assertion('asbp-structure',[ASBP],'debt.json','/structure/groups/0/rows/0/values',maturity));
 const prose=input.debt.pages.filter(p=>[139,140,141].includes(p.page)).map(p=>p.body).join(' ').replace(/\s+/gu,' '),newDebt=/Поетият нов дълг през 2025 г\. е в размер на ([\d ]+,\d) млн\. евро/.exec(prose);if(!newDebt)throw new Error('Independent debt issuance source absent');debt.push(assertion('asbp-issuance',[ASBP],'debt.json','/newDebt/y2025/totalMln',Number(newDebt[1]!.replaceAll(' ','').replace(',','.'))));
 const paragraphs=input.fiscal.law.dvBlocks.zdb.filter(b=>b[0]==='p').map(b=>b[1] as string);
 const article=paragraphs.findIndex(t=>/^Чл\. 66\./.test(t)),text=paragraphs.slice(article,article+2).join(' '),cap=/([\d,]+) млрд\. евро/.exec(text);if(article<0||!cap)throw new Error('Independent adopted-law debt cap absent');debt.push(assertion('adopted-law-limits',[LAW],'debt.json','/limits/items/0/mln',Number(cap[1]!.replace(',','.'))*1000));
 const annual='data/originals/eurostat/gov_10dd_edpt1_BG_EU.json',quarter='data/originals/eurostat/gov_10q_ggdebt_BG.json';
 for(const [path,scope,pointer] of [[annual,'eurostat-annual','/maastricht/bg'],[quarter,'eurostat-quarterly','/quarterly/eurostat']] as const){const js=parseEurostatSnapshot(read(path));for(const [unit,key] of [['MIO_EUR','mln'],['PC_GDP','pctGdp']]){const series=jsonstatSeries(js,'time',{geo:'BG',unit:unit!});debt.push(assertion(scope,[path],'debt.json',pointer+'/'+key,Object.keys(series).sort().map(y=>pythonRound(series[y]![0],3))));}}
 for(const [path,indicator,key,scope] of [['data/originals/bnb_sdmx/ggd.xml','GGALN_G01_XDC','bnbGg','bnb-gg'],['data/originals/bnb_sdmx/cgd.xml','GCALN_G01_AC_XDC','bnbCg','bnb-cg']] as const){const series=parseBnbSdmx(read(path),indicator);for(const field of ['quarters','mln','asOf'] as const)debt.push(assertion(scope,[path],'debt.json','/quarterly/'+key+'/'+field,series[field]));}
 const municipal:SourceAssertion[]=[],gis=[...input.municipalities.gis.items].sort((a,b)=>a.id.localeCompare(b.id));
 const normalize=(s:string)=>s.toLowerCase().replace(/[\s\-–—„“”"«»]/gu,'');
 const lawRows=input.municipalities.art.law.rows;
 for(let i=0;i<gis.length;i++){
  const item=gis[i]!;let population=item.pop;if(item.id==='DOB15')population=Math.min(item.pop,gis.find(x=>x.id==='DOB28')!.pop);if(item.id==='DOB28')population=Math.max(item.pop,gis.find(x=>x.id==='DOB15')!.pop);
  municipal.push(assertion('gisco-identities-population',[GIS],'municipalities.json',`/items/${i}/population`,population));
  municipal.push(assertion('gisco-geometry',[GIS],'geo/obshtini.json',`/features/${i}/properties/id`,item.id));
  const manual:Record<string,string>={'DOB15':'Добричка','KNL04':'Бобовдол','SOF46':'СТОЛИЧНА ОБЩИНА'};
  const name=manual[item.id]??item.name,candidates=lawRows.filter(r=>normalize(r.name)===normalize(name));
  const regionNames:Record<string,string>={BLG:'БЛАГОЕВГРАД',BGS:'БУРГАС',VAR:'ВАРНА',VTR:'ВЕЛИКО ТЪРНОВО',VID:'ВИДИН',VRC:'ВРАЦА',GAB:'ГАБРОВО',DOB:'ДОБРИЧ',KRZ:'КЪРДЖАЛИ',KNL:'КЮСТЕНДИЛ',LOV:'ЛОВЕЧ',MON:'МОНТАНА',PAZ:'ПАЗАРДЖИК',PER:'ПЕРНИК',PVN:'ПЛЕВЕН',PDV:'ПЛОВДИВ',RAZ:'РАЗГРАД',RSE:'РУСЕ',SLS:'СИЛИСТРА',SLV:'СЛИВЕН',SML:'СМОЛЯН',SOF:'СОФИЯ (СТОЛИЦА)',SFO:'СОФИЙСКА',SZR:'СТАРА ЗАГОРА',TGV:'ТЪРГОВИЩЕ',HKV:'ХАСКОВО',SHU:'ШУМЕН',JAM:'ЯМБОЛ'};
  const regionCandidates=candidates.filter(r=>r.region==='ОБЛАСТ '+regionNames[item.id.slice(0,3)]);
  const row=regionCandidates.length===1?regionCandidates[0]:undefined;
  if(!row)throw new Error('Independent municipal source match absent/ambiguous: '+item.id);
  input.municipalities.art.cols.forEach((key,c)=>municipal.push(assertion('adopted-law-transfers',[LAW],'municipalities.json',`/items/${i}/transfers/${key}`,row.values[c]??0)));
 }
 // Oblast source is a saved JSON-stat observation, not a fresh raw GISCO claim.
 const oblastSeries=jsonstatSeries(input.municipalities.oblast.jsonstat,'geo',{time:'2025',sex:'T',age:'TOTAL'});
 municipal.push(assertion('eurostat-oblast-population',[OBLAST],'municipalities.json','/totals/population2025Sum',Object.values(oblastSeries).reduce((sum,v)=>sum+v[0],0)));
 const sebra:SourceAssertion[]=[],listing='data/originals/sebra/midt_sebra_2026_page.html',xlsx='data/originals/sebra/midt_sebra_31.08.2026.xlsx';
 for(const field of ['section','sectionPublished','page','retrieved'] as const)sebra.push(assertion('publication-listing',[listing],'sebra.json','/publication/'+field,input.sebra.listing[field]));
 const days=input.sebra.listing.files;
 for(let i=0;i<days.length;i++){const day=days[i]!,path=day.day==='2026-08-31'?xlsx:`data/cache/sebra_${day.day.slice(8)}.08.2026.xlsx`,rows=input.sebra.files[day.day]!.rows,total=rows.find(r=>r.A?.startsWith('Общо:'));if(!total||!/^\d+$/.test(total.C!))throw new Error('Independent SEBRA total absent');sebra.push(assertion('xlsx-payments',[path],'sebra.json',`/days/${i}/count`,Number(total.C)),assertion('xlsx-payments',[path],'sebra.json',`/days/${i}/eur`,Number(total.D)));
 }
 const first=input.sebra.files['2026-08-31']!.rows.find(r=>r.A?.startsWith('М-во на електронното управл')&&r.C?.startsWith('Период:'));if(!first)throw new Error('Independent SEBRA ministry header absent');sebra.push(assertion('ministry-identity',[xlsx],'sebra.json','/ministryPrinted',first.A!.replace(/\s*\([^)]*\)\s*$/u,'').replaceAll('e','е').replace(/\s+/gu,' ').trim()));
 const sourceGroups=createDebtLocalSourceGroups({DEBT:{pins:[...pin([ASBP],'asbp'),...pin([LAW],'zdb'),...pin([annual,quarter],'eurostat'),...pin(['data/originals/bnb_sdmx/ggd.xml','data/originals/bnb_sdmx/cgd.xml'],'bnb')],read:()=>({level:'original',assertions:debt})},MUNIC:{pins:[...pin([LAW],'zdb'),...pin([GIS],'gisco'),...pin([OBLAST],'eurostat')],read:()=>({level:'original',assertions:municipal})},SEBRA:{pins:pin([listing,xlsx,'data/cache/sebra_27.08.2026.xlsx','data/cache/sebra_28.08.2026.xlsx'],'sebra'),read:()=>({level:'original',assertions:sebra})}});
 return [...sourceGroups,{name:'MUNIC_GEOMETRY_SOURCE',description:'All output vertices originate in the authenticated reduced GISCO cache',run(ctx){const c=new Check('MUNIC_GEOMETRY_SOURCE');for(const feature of ctx.get('geo/obshtini.json').features){const original=gis.find(g=>g.id===feature.properties.id);if(!c.ok(original,'Geometry source identity'))continue;const vertices=new Set(original!.rings.flat(2).map(p=>`${pythonRound(p[0],3)},${pythonRound(p[1],3)}`));const coordinates=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;for(const p of coordinates.flat(2))c.ok(vertices.has(`${p[0]},${p[1]}`),'Geometry vertex absent from source: '+original!.id);}c.warn('Reduced GISCO cache verified; unavailable original historical GeoJSON remains unverified.');return c;}}];
}
