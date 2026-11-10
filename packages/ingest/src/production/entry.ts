import { mkdir,writeFile } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { runGraph } from '../build/graph.js';
import { wave13bStages } from '../build/wave13b.js';
import type { ExecutionContext,ExecutorResult } from '../release-build/types.js';
import { loadProduction } from './loader.js';
import { validateProduction } from './validation.js';
/** This is the committed entry loaded by the offline exported-code compiler. */
export async function executeRelease(context:Readonly<ExecutionContext>):Promise<ExecutorResult>{
  const prepared=await loadProduction(context);
  const graph=runGraph(wave13bStages(prepared.input));
  const failed=graph.states.filter(s=>s.status!=='success');
  if(failed.length)throw new Error('Production graph failed: '+JSON.stringify(failed));
  const publication=graph.outputs.get('publication-layers') as {streams:Map<string,Uint8Array>};
  if(!publication?.streams.size)throw new Error('Production graph did not publish outputs');
  for(const [path,bytes] of publication.streams){
    if(path.startsWith('releases/'))throw new Error('Lifecycle metadata must not be produced by the graph');
    const destination=join(context.candidateRoot,'data',path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes,{flag:'wx'});
  }
  const validation=validateProduction(context,prepared);
  const {parse}=await import('yaml');const {readFile}=await import('node:fs/promises');
  const registry=parse((await readFile(join(context.exportRoot,'data/datasets.yaml'))).toString());
  return {validation,datasets:registry.datasets.filter((d:any)=>d.status!=='pending'&&d.id!=='releases').map((d:any)=>({id:d.id,action:d.id==='gva-sectors'?'preserved-input':'built'})),extractions:[...prepared.extractions,{schema:'production-graph/1',stages:graph.states,rawReconstruction:'unverified'}]};
}
