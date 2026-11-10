/** Finite offline adapter: all workspace code comes exclusively from the recorded export. */
import { createRequire } from 'node:module';
import { readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { ReleaseExecutor, ExecutorResult } from '../release-build/types.js';
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const ENTRY='packages/ingest/src/production/entry.ts';
const RUNNER=`import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';import {registerHooks} from 'node:module';
const forbidden=new Set(['net','http','https','http2','dns','dns/promises','tls','dgram','undici']);
const check=id=>{if(forbidden.has(id.replace(/^node:/,'')))throw Error('Production builds are offline');};
registerHooks({resolve(id,ctx,next){check(id);return next(id,ctx);}});
const builtin=process.getBuiltinModule;process.getBuiltinModule=id=>{check(id);return builtin(id);};
globalThis.fetch=()=>{throw Error('Production builds are offline');};globalThis.WebSocket=undefined;globalThis.EventSource=undefined;
const request=JSON.parse(await readFile(process.argv[2],'utf8'));
const {executeRelease}=await import(pathToFileURL(request.entry).href);
const result=await executeRelease(Object.freeze(request.context));
await writeFile(request.result,JSON.stringify(result)+'\\n',{flag:'wx'});
`;
/** Trusted installed compiler/dependencies must have exactly the processing commit's lock. */
export async function productionExecutor(dependenciesRoot:string):Promise<ReleaseExecutor>{
  dependenciesRoot=resolve(dependenciesRoot);
  const require=createRequire(join(dependenciesRoot,'packages/ingest/package.json'));
  const compiler=require.resolve('esbuild'), compilerApi=require('esbuild') as typeof import('esbuild');
  const compilerPackage=JSON.parse(await readFile(join(dirname(compiler),'../package.json'),'utf8'));
  if(compilerPackage.version!=='0.28.2')throw new Error('Expected locked offline compiler esbuild 0.28.2');
  const binary=createRequire(compiler).resolve('@esbuild/linux-x64/bin/esbuild');
  const adapterHash=sha(await readFile(fileURLToPath(import.meta.url)));
  const compilerIdentity={engine:'esbuild/0.28.2',apiSha256:sha(await readFile(compiler)),binarySha256:sha(await readFile(binary)),runnerSha256:sha(RUNNER),adapterSha256:adapterHash};
  const bridgeSha256=sha(JSON.stringify(compilerIdentity));
  return {identity:{runtime:'node-export/1',id:'registered-typescript-production/1',entry:ENTRY},dependenciesRoot,bridgeSha256,
  async execute(context){
    const lock=await readFile(join(dependenciesRoot,'pnpm-lock.yaml'));
    if(!lock.equals(await readFile(join(context.exportRoot,'pnpm-lock.yaml'))))throw new Error('Offline compiler lock mismatch');
    const scratch=context.scratchRoot,root=context.exportRoot;
    const { listFiles } = await import('../release-client/files.js');
    await writeFile(join(scratch,'exported-paths.json'),JSON.stringify(await listFiles(root)),{flag:'wx'});
    // Assets retain their locked package bytes; no compiler installation, subprocess scripts or fetching.
    const mupdf=dirname(require.resolve('mupdf'));
    await cp(join(mupdf,'mupdf-wasm.wasm'),join(scratch,'mupdf-wasm.wasm'));
    await cp(dirname(require.resolve('7z-wasm')),join(scratch,'7z'),{recursive:true});
    const options:import('esbuild').BuildOptions={bundle:true,platform:'node',format:'esm',target:'node24',mainFields:['main','module'],nodePaths:[join(dependenciesRoot,'packages/ingest/node_modules'),join(dependenciesRoot,'node_modules')],metafile:true,minifyWhitespace:true,legalComments:'none',logLevel:'silent',banner:{js:"import {createRequire as __offlineCreateRequire} from 'node:module';const require=__offlineCreateRequire(import.meta.url);"},plugins:[{name:'exported-workspace-only',setup(build){build.onResolve({filter:/^@sigma-budget\//},args=>{const match=/^@sigma-budget\/(dataset-schema|ingest)(?:\/(.+))?$/.exec(args.path);if(!match)throw new Error('Unresolved workspace alias '+args.path);return {path:join(root,'packages',match[1]!,'src',match[2]?match[2]+'/index.ts':'index.ts')};});}}]};
    const compiled=[];
    for(const [entry,out] of [[ENTRY,'production.mjs'],['packages/ingest/src/readers/publication-documents/archive-worker.ts','archive-worker.js']]){
      const result=await compilerApi.build({...options,absWorkingDir:root,entryPoints:[join(root,entry!)],outfile:join(scratch,out!)});
      for(const file of Object.keys(result.metafile!.inputs)){
        const path=resolve(root,file),rel=relative(root,path);
        const fromExport=rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);
        if(!fromExport && (!path.includes('/node_modules/') || /\/node_modules\/@sigma-budget\//.test(path)))throw new Error('Compiler resolved code outside export/dependencies: '+file);
      }
      compiled.push({entry,output:out,sha256:sha(await readFile(join(scratch,out!)))});
    }
    await writeFile(join(scratch,'package.json'),'{"type":"module"}\n',{flag:'wx'});
    const request=join(scratch,'production-request.json'),result=join(scratch,'production-result.json'),runner=join(scratch,'production-runner.mjs');
    await writeFile(runner,RUNNER,{flag:'wx'});await writeFile(request,JSON.stringify({entry:join(scratch,'production.mjs'),context,result}),{flag:'wx'});
    try{await promisify(execFile)(process.execPath,['--permission','--allow-worker','--no-addons','--disable-proto=throw',`--allow-fs-read=${root}`,`--allow-fs-read=${scratch}`,`--allow-fs-read=${context.candidateRoot}`,`--allow-fs-write=${scratch}`,`--allow-fs-write=${context.candidateRoot}`,'--max-old-space-size=8192',runner,request],{cwd:root,timeout:300000,maxBuffer:1024*1024,env:{TZ:'UTC',LANG:'C.UTF-8',HOME:scratch,BUILD_DATE:context.buildDate}});}catch(e){throw new Error('Exported production executor failed: '+String((e as any).stderr??e));}
    const b=await readFile(result);if(b.length>32*1024*1024)throw new Error('Production result exceeds limit');
    const value=JSON.parse(b.toString('utf8')) as ExecutorResult;
    value.extractions=[...(value.extractions??[]),{schema:'offline-compiler/1',...compilerIdentity,compiled}];return value;
  }};
}
