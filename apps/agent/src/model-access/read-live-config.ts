import { lstat,open } from 'node:fs/promises';
import { LiveServiceConfigSchema } from '../../../../packages/contracts/src/live-model.ts';
/** Operator-owned JSON only; no .env parsing or implicit credential discovery. */
export async function readLiveServiceConfig(path:string){let handle;
 try{
  if((await lstat(path)).isSymbolicLink())throw Error('link');handle=await open(path,'r');if(!(await handle.stat()).isFile())throw Error('file');
  const b=Buffer.alloc(256*1024+1);let n=0;
  while(n<b.length){const r=await handle.read(b,n,b.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}
  if(n===b.length)throw Error('size');return LiveServiceConfigSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,n))));
 }catch{throw Error('LIVE_MODEL_CONFIG_INVALID');}finally{await handle?.close();}
}
