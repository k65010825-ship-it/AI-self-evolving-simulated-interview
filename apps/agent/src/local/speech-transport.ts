/** Track physical transport completion independently from an adapter's cancellation race. */
export function createLocalSpeechTransport(fetcher:(url:string,init:RequestInit)=>Promise<Response>){
 const pending=new Set<Promise<unknown>>();
 function track<T>(promise:Promise<T>):Promise<T>{pending.add(promise);void promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;}
 return{
  async fetch(url:string,init:RequestInit){const response=await track(Promise.resolve().then(()=>fetcher(url,init)));if(!response.body)return response;
   const reader=response.body.getReader();const body=new ReadableStream<Uint8Array>({
    async pull(controller){try{const part=await track(reader.read());if(part.done)controller.close();else controller.enqueue(part.value);}catch(error){controller.error(error);}},
    cancel(reason){return track(Promise.resolve().then(()=>reader.cancel(reason)));},
   });return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  },
  get pendingCount(){return pending.size;},
  async drain(){while(pending.size)await Promise.allSettled([...pending]);},
 };
}
