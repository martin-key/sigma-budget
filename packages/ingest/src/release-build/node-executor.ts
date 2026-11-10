import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { readSafeBytes } from '../release-client/files.js';
import { atomicNew, fail, jsonBytes, safeRelative, sha256 } from './files.js';
import type { ReleaseExecutor, ExecutorIdentity, ExecutorResult } from './types.js';

// Small explicit ABI. The imported module is ALWAYS the committed export, including in reproduction.
const BRIDGE = `import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
const denied=new Set(['net','http','https','http2','dns','dns/promises','tls','dgram','undici']);
const check=(id)=>{if(denied.has(id.replace(/^node:/,'')))throw Error('Offline executor forbids network modules');};
registerHooks({resolve(id,ctx,next){check(id);return next(id,ctx);}});
const original=process.getBuiltinModule;
process.getBuiltinModule=(id)=>{check(id);return original(id);};
globalThis.fetch=()=>{throw Error('Offline executor forbids fetch');};
globalThis.WebSocket=undefined;globalThis.EventSource=undefined;
const request=JSON.parse(await readFile(process.argv[2],'utf8'));
const module=await import(pathToFileURL(request.entry).href);
if(typeof module.executeRelease!=='function') throw Error('Recorded entry must export executeRelease(context)');
const result=await module.executeRelease(request.context);
await writeFile(request.result,JSON.stringify(result)+'\\n',{flag:'wx'});
`;
export const NODE_BRIDGE_SHA256 = sha256(BRIDGE);
/** Native offline Node entry (.mjs/.js, or Node 24 erasable .ts using resolvable imports).
 * No package installation/build scripts, Python, subprocess permission or network imports/fetch.
 * Entries needing bundling must use a trusted exported-code adapter instead. */
export function recordedNodeExecutor(
  identity: Omit<ExecutorIdentity, 'runtime'>,
  timeoutMs = 120_000,
): ReleaseExecutor {
  identity = Object.freeze({ ...identity });
  safeRelative(identity.entry);
  if (!/\.(?:mjs|js|ts)$/.test(identity.entry) || !identity.id || identity.id.length > 200)
    fail('Invalid recorded Node executor identity');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    fail('Executor timeout must be finite (at most five minutes)');
  return {
    identity: { runtime: 'node-export/1', ...identity },
    bridgeSha256: NODE_BRIDGE_SHA256,
    async execute(context) {
      const request = join(context.scratchRoot, 'request.json');
      const result = join(context.scratchRoot, 'result.json');
      const bridge = join(context.scratchRoot, 'bridge.mjs');
      await atomicNew(bridge, Buffer.from(BRIDGE));
      await atomicNew(
        request,
        jsonBytes({ entry: join(context.exportRoot, identity.entry), result, context }),
      );
      try {
        await promisify(execFile)(
          process.execPath,
          [
            '--permission',
            '--no-addons',
            '--disable-proto=throw',
            `--allow-fs-read=${context.exportRoot}`,
            `--allow-fs-read=${context.scratchRoot}`,
            `--allow-fs-read=${context.candidateRoot}`,
            `--allow-fs-write=${context.scratchRoot}`,
            `--allow-fs-write=${context.candidateRoot}`,
            bridge,
            request,
          ],
          {
            cwd: context.exportRoot,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            env: {
              TZ: 'UTC',
              LANG: 'C.UTF-8',
              HOME: context.scratchRoot,
              BUILD_DATE: context.buildDate,
            },
          },
        );
      } catch {
        fail('Recorded Node executor failed or exceeded its finite runtime/output limit');
      }
      return JSON.parse(
        (await readSafeBytes(result, 32 * 1024 * 1024)).toString('utf8'),
      ) as ExecutorResult;
    },
  };
}
