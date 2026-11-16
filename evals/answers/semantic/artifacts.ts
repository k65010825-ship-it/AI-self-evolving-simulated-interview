import { lstat,open } from 'node:fs/promises';
import { verifySemanticReport } from './report.ts';
import { collectDeliverySources } from '../../delivery/sources.ts';
export async function readSemanticReport(path:string){let handle;
 try{
  if((await lstat(path)).isSymbolicLink())throw Error('link');handle=await open(path,'r');if(!(await handle.stat()).isFile())throw Error('file');
  const buffer=Buffer.alloc(4*1024*1024+1);let count=0;
  while(count<buffer.length){const r=await handle.read(buffer,count,buffer.length-count,null);if(!r.bytesRead)break;count+=r.bytesRead;}
  if(count===buffer.length)throw Error('size');
  return verifySemanticReport(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,count))),await collectDeliverySources(process.cwd()));
 }catch{throw new Error('SEMANTIC_ARTIFACT_INVALID');}finally{await handle?.close();}
}
