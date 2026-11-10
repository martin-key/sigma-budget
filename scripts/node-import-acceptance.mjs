/** Mandatory real-input acceptance. No environment-variable skip and no source acquisition. */
import {strict as assert} from 'node:assert';
import {readFile,writeFile,mkdir,rm,cp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {buildRelease,reproduceRelease,checkReleaseDirectory,exportCommit,prepareInputs,stageInputs} from '../packages/ingest/dist/release-build/index.js';
import {productionExecutor,loadProduction,validateProduction} from '../packages/ingest/dist/production/index.js';
import {listFiles} from '../packages/ingest/dist/release-client/files.js';
import {runGraph} from '../packages/ingest/dist/build/graph.js';
import {wave13bStages} from '../packages/ingest/dist/build/wave13b.js';
import {compare} from '../packages/ingest/dist/parity/compare.js';
import {auditCatalogMetadata} from '../packages/ingest/dist/build/catalog-metadata.js';
const root=resolve(dirname(new URL(import.meta.url).pathname),'..'),[inputArg,outArg,date='2026-11-10',reference]=process.argv.slice(2);
assert(inputArg&&outArg,'Usage: node scripts/node-import-acceptance.mjs INPUTS NEW_OUTPUT_ROOT YYYY-MM-DD [PYTHON_REFERENCE]');
const inputs=resolve(inputArg),out=resolve(outArg);assert(!existsSync(out),'Acceptance output must be new');await mkdir(out,{recursive:true});
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),executor=await productionExecutor(root);
const common={repositoryRoot:root,commit,inputRoot:inputs,buildDate:date,executor,maxObjectBytes:67108864};
const first=await buildRelease({...common,outputRoot:join(out,'candidate')});
const second=await buildRelease({...common,outputRoot:join(out,'second')});
assert.equal(second.releaseId,first.releaseId,'Same commit/date/snapshot must produce identical IDs');
for(const p of await listFiles(first.outputRoot))assert.deepEqual(await readFile(join(first.outputRoot,p)),await readFile(join(second.outputRoot,p)),p);
const replay=await reproduceRelease({...common,releaseRoot:first.outputRoot,outputRoot:join(out,'replay')});assert.equal(replay.releaseId,first.releaseId);
await checkReleaseDirectory({releaseRoot:first.outputRoot,inputRoot:inputs,maxObjectBytes:67108864});
const controls=[],work=join(out,'controls');await mkdir(work);const exported=await exportCommit(root,commit,join(work,'export'));
try{
 const source=join(work,'export'),preparedInputs=await prepareInputs(source,inputs);await stageInputs(preparedInputs,source);const scratch=join(work,'scratch');await mkdir(scratch);await writeFile(join(scratch,'exported-paths.json'),JSON.stringify(Object.keys(exported.files)));
 const require=createRequire(join(root,'packages/ingest/package.json'));await cp(dirname(require.resolve('7z-wasm')),join(scratch,'7z'),{recursive:true});
 const context={exportRoot:source,candidateRoot:first.outputRoot,scratchRoot:scratch,commit,buildDate:date,inputs:preparedInputs.inputs};
 const prepared=await loadProduction(context);assert.equal(validateProduction(context,prepared).completeValidation,true);
 const cases=[['number','debt.json',d=>{d.zdd.totalMln[0]+=1;}],['provenance','execution-provenance.json',d=>{d.rows.rev+=1;}],['unit','rates.json',d=>{d.meta.unit='BGN';}]];
 for(const [name,file,mutate]of cases){const candidate=join(work,name);await cp(join(first.outputRoot,'data'),join(candidate,'data'),{recursive:true});const path=join(candidate,'data',file),doc=JSON.parse(await readFile(path,'utf8'));mutate(doc);await writeFile(path,JSON.stringify(doc)+'\n');assert.throws(()=>validateProduction({...context,candidateRoot:candidate},prepared),/Production validation failed/);assert(!existsSync(join(candidate,'manifest.json')));controls.push(name+': rejected by executed rules');await rm(candidate,{recursive:true});}
 const forecast=join(source,'data/inputs/budget_forecast_2027.json'),old=await readFile(forecast),changed=JSON.parse(old);changed.tables.annex1_execution2026.rows[0].values[0]+=1;await writeFile(forecast,JSON.stringify(changed));await assert.rejects(prepareInputs(source,inputs),/pin/);await writeFile(forecast,old);controls.push('stale committed intermediate: rejected');
 const snapshot=join(work,'missing');await mkdir(snapshot);for(const base of ['data/originals','data/cache'])await cp(join(source,base),join(snapshot,base),{recursive:true});await rm(join(snapshot,'data/originals/nap/nap_prilozhenie_1_VK-30-10237_12.08.2026.pdf'));await assert.rejects(prepareInputs(source,snapshot),/Missing declared input/);controls.push('missing declared raw: rejected');
 const broken=wave13bStages(prepared.input).map(s=>s.id==='rates'?{...s,run(){throw Error('owned failed-stage control');}}:s),graph=runGraph(broken);assert.equal(graph.states.find(s=>s.id==='rates').status,'failed');assert.equal(graph.states.find(s=>s.id==='publication-layers').status,'skipped');assert(!graph.outputs.has('publication-layers'));controls.push('failed stage: no publication/PASS package');
 if(reference){
  const registry=require('yaml').parse(await readFile(join(root,'data/datasets.yaml'),'utf8')),routes=JSON.parse(await readFile(join(root,'apps/web/app/lib/routes.json'),'utf8')),owners=new Map(),differences=[],metadata=[];
  for(const f of first.manifest.outputs.filter(f=>f.path.startsWith('data/'))){const name=f.path.slice(5),a=await readFile(join(reference,f.path)),b=await readFile(join(first.outputRoot,f.path));owners.set(name,b);if(name.endsWith('.xml'))assert.deepEqual(a,b,'RSS bytes');else for(const d of compare(JSON.parse(a),JSON.parse(b),{dataset:f.dataset,file:name})){if(name==='catalog.json'&&/^\/datasets\/\d+\/(?:bytes|gzipBytes|parts\/\d+\/(?:bytes|gzipBytes))$/.test(d.pointer))metadata.push(d);else differences.push(d);}}
  const audit=auditCatalogMetadata({catalogBytes:owners.get('catalog.json'),ownerBytes:owners,registry:registry.datasets,activeRoutes:routes.routes.map(r=>r[0])});assert.deepEqual(audit.reported,audit.computed);await writeFile(join(out,'python-comparison.json'),JSON.stringify({differences,byteDerivedCatalog:metadata,metadataValid:true},null,2)+'\n');assert.deepEqual(differences,[],'All JSON values and exact money/source fields must match Python');
 }
}finally{await rm(work,{recursive:true,force:true});}
const report={head:commit,releaseId:first.releaseId,candidate:first.outputRoot,outputs:first.manifest.outputs.length,inputs:first.manifest.inputs.length,doubleBuild:'all package bytes identical',reproduce:'all package bytes and ID identical',controls,historicalReconstruction:'unverified'};
await writeFile(join(out,'acceptance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
