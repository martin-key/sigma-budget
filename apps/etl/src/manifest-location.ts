import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { join,dirname,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { nodeHttpTransport, releaseEnvironment, parseManifest, ReleaseError, nodeProofReceipt, canonicalJson, type HttpTransport, type ReleaseManifest } from '@sigma-budget/ingest/release-client';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
export interface LocatedManifest {bytes:Buffer;manifest:ReleaseManifest;releaseId:string;base:string;remote:boolean;}
export async function getBytes(url:string,transport:HttpTransport=nodeHttpTransport,limit=67108864):Promise<Buffer>{
 const parsed=new URL(url);releaseEnvironment({name:'explicit-source',url:parsed.origin});if(parsed.username||parsed.password||parsed.hash)throw new ReleaseError(2,'Invalid explicit release URL');
 const response=await transport({method:'GET',url:parsed.href,headers:{},timeoutMs:30000,maxResponseBytes:limit});if(response.status!==200||response.body.length>limit)throw new ReleaseError(3,'Release object unavailable or oversized');return Buffer.from(response.body);
}
/** Existing Worker current protocol, with the documented static-site fallback. */
export async function locateManifest(selection:{manifest?:string;current?:string},transport?:HttpTransport):Promise<LocatedManifest>{
 if(Number(!!selection.manifest)+Number(!!selection.current)!==1)throw new ReleaseError(2,'Choose exactly one --manifest or --current');
 let path=selection.manifest!,expected:string|undefined;
 if(selection.current){const site=new URL(selection.current);releaseEnvironment({name:'explicit-current',url:site.href});let pointer;
  try{pointer=JSON.parse((await getBytes(new URL('/api/releases/current',site).href,transport,1024*1024)).toString('utf8'));}
  catch(e){if(!(e instanceof ReleaseError)||e.code!==3)throw e;pointer=JSON.parse((await getBytes(new URL('/data/releases/current.json',site).href,transport,1024*1024)).toString('utf8'));}
  if(!/^[a-f0-9]{64}$/.test(pointer.release_id))throw new ReleaseError(2,'Invalid current release identity');expected=pointer.release_id;
  const wanted='/data/releases/'+expected+'/manifest.json';if(pointer.manifest!==undefined&&pointer.manifest!==wanted&&pointer.manifest!==wanted.slice(1))throw new ReleaseError(2,'Current manifest path differs from release identity');path=new URL(wanted,site).href;
 }
 const remote=/^https?:\/\//.test(path),bytes=remote?await getBytes(path,transport,4*1024*1024):await readFile(resolve(path));
 const releaseId=sha(bytes);if(expected&&releaseId!==expected)throw new ReleaseError(2,'Current manifest SHA-256 differs from pointer');
 return {bytes,manifest:parseManifest(bytes,67108864),releaseId,remote,base:remote?new URL('.',path).href:dirname(resolve(path))};
}
export async function materializeRemote(location:LocatedManifest,root:string,transport?:HttpTransport,includeInputs=false){
 await mkdir(root,{recursive:false});await writeFile(join(root,'manifest.json'),location.bytes,{flag:'wx'});
 for(const f of [...location.manifest.outputs,...(includeInputs?location.manifest.inputs:[])]){
  const b=await getBytes(new URL(f.path.split('/').map(encodeURIComponent).join('/'),location.base).href,transport);
  if(b.length!==f.bytes||sha(b)!==f.sha256)throw new ReleaseError(2,'Remote object differs from manifest: '+f.path);
  const path=join(root,f.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,b,{flag:'wx'});
 }
 const receipt=nodeProofReceipt(location.manifest,location.releaseId,await readFile(join(root,'validation.json')));
 await writeFile(join(root,'receipt.json'),canonicalJson(receipt)+'\n',{flag:'wx'});
 return root;
}
