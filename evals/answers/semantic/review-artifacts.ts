import { lstat,open } from 'node:fs/promises';
export async function readReviewJson(path:string):Promise<unknown>{let handle;
 try{if((await lstat(path)).isSymbolicLink())throw Error('link');handle=await open(path,'r');if(!(await handle.stat()).isFile())throw Error('file');
  const buffer=Buffer.alloc(4*1024*1024+1);let count=0;
  while(count<buffer.length){const r=await handle.read(buffer,count,buffer.length-count,null);if(!r.bytesRead)break;count+=r.bytesRead;}
  if(count===buffer.length)throw Error('size');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,count)));
 }catch{throw Error('SEMANTIC_REVIEW_FILE_INVALID');}finally{await handle?.close();}
}
