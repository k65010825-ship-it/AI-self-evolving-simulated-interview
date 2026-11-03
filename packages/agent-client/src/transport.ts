import{clientError,normalize}from'./errors.ts';

/** Local cancellation stops requests/subscriptions; it never sends remote cancellation. */
export class RequestScope{
 readonly controller=new AbortController();readonly failure:Promise<never>;
 private reject!:(e:Error)=>void;private reason:Error|undefined;private timer:ReturnType<typeof setTimeout>;
 private readonly deadline:number;
 private readonly onAbort=()=>this.abort(clientError('ABORTED'));
 constructor(readonly timeoutMs:number,private readonly caller?:AbortSignal){
  this.deadline=performance.now()+timeoutMs;
  this.failure=new Promise<never>((_r,reject)=>{this.reject=reject;});void this.failure.catch(()=>{});
  this.timer=setTimeout(()=>this.abort(clientError('TIMEOUT')),timeoutMs);
  caller?.addEventListener('abort',this.onAbort,{once:true});if(caller?.aborted)this.onAbort();
 }
 get signal(){return this.controller.signal;}
 abort(error:Error){if(this.reason)return;this.reason=error;this.controller.abort();this.reject(error);}
 check(){if(!this.reason&&performance.now()>=this.deadline)this.abort(clientError('TIMEOUT'));if(this.reason)throw this.reason;}
 async race<T>(work:Promise<T>):Promise<T>{try{this.check();const value=await Promise.race([work,this.failure]);this.check();return value;}catch(error){void work.catch(()=>{});this.check();throw normalize(error);}}
 dispose(){clearTimeout(this.timer);this.caller?.removeEventListener('abort',this.onAbort);this.controller.abort();}
}
export async function readChunk(reader:ReadableStreamDefaultReader<Uint8Array>,scope:RequestScope,idleMs?:number){
 let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_r,reject)=>{if(idleMs!==undefined)timer=setTimeout(()=>reject(clientError('TIMEOUT')),idleMs);});
 try{return await scope.race(Promise.race([reader.read(),timeout]));}finally{if(timer!==undefined)clearTimeout(timer);}
}
export async function readJson(response:Response,scope:RequestScope,maxBytes:number):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw clientError('PROTOCOL_ERROR');
 const cancel=()=>{void reader.cancel().catch(()=>{});};scope.signal.addEventListener('abort',cancel,{once:true});
 const chunks:Uint8Array[]=[];let total=0;
 try{
  while(true){const result=await readChunk(reader,scope);if(result.done)break;
   total+=result.value.length;if(total>maxBytes)throw clientError('PROTOCOL_ERROR');chunks.push(result.value);}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw clientError('PROTOCOL_ERROR');}
  scope.check();return parsed;
 }finally{scope.signal.removeEventListener('abort',cancel);cancel();}
}
export async function delay(ms:number,scope:RequestScope){let timer:ReturnType<typeof setTimeout>|undefined;
 try{await scope.race(new Promise<void>(resolve=>{timer=setTimeout(resolve,ms);}));}finally{if(timer!==undefined)clearTimeout(timer);}}
