import {test,expect} from 'bun:test';
import {createRuntimeCredentialBroker} from '../apps/agent/src/local/credential-broker.ts';
import {createMainCredentialBroker} from '../packages/local-agent-client/src/credential-broker.ts';
import {LocalCredentialRequestSchema,LocalCredentialResponseSchema,LocalCredentialCancelSchema} from '../packages/contracts/src/local-credential.ts';

const binding=()=>({grantId:'grant-1',credentialRef:'synthetic-key',expiresAt:Date.now()+10000});
function pair(options:{timeoutMs?:number;maxRequests?:number;resolveCredential?:(context:{signal:AbortSignal})=>Promise<string|undefined>}={}){
 const ownerToken={}, requests:unknown[]=[],responses:unknown[]=[];
 const runtime=createRuntimeCredentialBroker({timeoutMs:options.timeoutMs??200,maxRequests:options.maxRequests??128,send:frame=>{requests.push(frame);void main.handle(frame,ownerToken);}});
 const main=createMainCredentialBroker({ownerToken,timeoutMs:options.timeoutMs??200,maxRequests:options.maxRequests??128,resolveCredential:options.resolveCredential??(async()=> 'synthetic-secret'),send:frame=>{responses.push(frame);runtime.receive(frame);}});
 runtime.setNegotiated(true);main.setNegotiated(true);const grant=binding();runtime.setGrant(grant);main.setGrant(grant);
 return{runtime,main,requests,responses,ownerToken,grant,close(){runtime.close();main.close();}};
}
test('private frames carry a synthetic secret only in the response and consume once',async()=>{
 const p=pair();try{expect(await p.runtime.request(p.grant)).toBe('synthetic-secret');expect(p.requests).toHaveLength(1);expect(JSON.stringify(p.requests)).not.toContain('synthetic-secret');
 expect(LocalCredentialRequestSchema.safeParse(p.requests[0]).success).toBe(true);expect(LocalCredentialResponseSchema.safeParse(p.responses[0]).success).toBe(true);
 expect(p.runtime.receive(p.responses[0])).toBe(false);expect(await p.main.handle(p.requests[0],p.ownerToken)).toBe(false);expect(p.runtime.pendingCount).toBe(0);
 }finally{p.close();}
});
test('wrong child, unnegotiated, wrong ref and expired grants do not invoke resolver',async()=>{
 const p=pair();try{const request={protocolVersion:1,type:'credential-request',requestId:crypto.randomUUID(),grantId:p.grant.grantId,credentialRef:p.grant.credentialRef};
 expect(await p.main.handle(request,{})).toBe(false);expect(await p.main.handle({...request,credentialRef:'wrong'},p.ownerToken)).toBe(false);
 p.runtime.setNegotiated(false);await expect(p.runtime.request(p.grant)).rejects.toThrow('CREDENTIAL_NOT_NEGOTIATED');
 p.main.setNegotiated(false);expect(await p.main.handle(request,p.ownerToken)).toBe(false);p.runtime.setNegotiated(true);p.runtime.setGrant({...p.grant,expiresAt:Date.now()-1});
 await expect(p.runtime.request(p.grant)).rejects.toThrow('CREDENTIAL_REVOKED');expect(p.responses).toHaveLength(0);
 }finally{p.close();}
});
test('cancel aborts resolver and ignores late secret',async()=>{
 let resolve!:(value:string)=>void,signal:AbortSignal|undefined;
 const p=pair({resolveCredential:async context=>{signal=context.signal;return new Promise<string>(r=>{resolve=r;});}});
 try{const abort=new AbortController();const pending=p.runtime.request(p.grant,{signal:abort.signal});abort.abort();await expect(pending).rejects.toThrow('CREDENTIAL_CANCELLED');
 expect(signal?.aborted).toBe(true);resolve('late-secret');await Bun.sleep(5);expect(p.runtime.pendingCount).toBe(0);expect(p.main.pendingCount).toBe(0);expect(JSON.stringify(p.responses)).not.toContain('late-secret');
 }finally{p.close();}
});
test('wrong binding cannot settle a request; revoke and close clean pending',async()=>{
 const frames:any[]=[];const broker=createRuntimeCredentialBroker({send:frame=>{frames.push(frame);}});broker.setNegotiated(true);const grant=binding();broker.setGrant(grant);
 const pending=broker.request(grant);expect(broker.receive({...frames[0],type:'credential-response',ok:true,secret:'bad',grantId:'other'})).toBe(false);
 broker.revoke(grant.grantId);await expect(pending).rejects.toThrow('CREDENTIAL_REVOKED');expect(broker.receive({...frames[0],type:'credential-response',ok:true,secret:'late'})).toBe(false);
 broker.setGrant(grant);const closing=broker.request(grant);broker.close();await expect(closing).rejects.toThrow('CREDENTIAL_CLOSED');expect(broker.pendingCount).toBe(0);
});
test('resolver errors are normalized, timeout clears both maps, no count reset by regrant',async()=>{
 const p=pair({maxRequests:1,resolveCredential:async()=>{throw Error('raw synthetic-secret');}});try{
 await expect(p.runtime.request(p.grant)).rejects.toThrow('CREDENTIAL_UNAVAILABLE');expect(JSON.stringify(p.responses)).not.toContain('raw');expect(JSON.stringify(p.responses)).not.toContain('synthetic-secret');
 p.runtime.setGrant(p.grant);await expect(p.runtime.request(p.grant)).rejects.toThrow('CREDENTIAL_RATE_LIMITED');
 }finally{p.close();}
 const slow=pair({timeoutMs:10,resolveCredential:async()=>new Promise(()=>{})});try{await expect(slow.runtime.request(slow.grant)).rejects.toThrow('CREDENTIAL_TIMEOUT');await Bun.sleep(5);expect(slow.runtime.pendingCount).toBe(0);expect(slow.main.pendingCount).toBe(0);}finally{slow.close();}
});
test('multiple grants stay isolated and expiry aborts an in-flight resolver',async()=>{
 const p=pair({resolveCredential:async()=>new Promise(()=>{})});try{
 const second={...p.grant,grantId:'grant-2',credentialRef:'synthetic-key-2'};p.runtime.setGrant(second);p.main.setGrant(second);
 const first=p.runtime.request(p.grant),other=p.runtime.request(second);p.runtime.revoke(p.grant.grantId);await expect(first).rejects.toThrow('CREDENTIAL_REVOKED');expect(p.runtime.pendingCount).toBe(1);expect(p.main.pendingCount).toBe(1);
 p.main.close();p.runtime.close();await expect(other).rejects.toThrow('CREDENTIAL_CLOSED');
 }finally{p.close();}
 let aborted=false;const expiry=pair({resolveCredential:async({signal})=>{signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});}});
 try{const grant={...expiry.grant,expiresAt:Date.now()+20};expiry.runtime.setGrant(grant);expiry.main.setGrant(grant);await expect(expiry.runtime.request(grant)).rejects.toThrow('CREDENTIAL_REVOKED');expect(aborted).toBe(true);expect(expiry.main.pendingCount).toBe(0);}finally{expiry.close();}
});
test('bounded queues, bindings, cumulative counts and main replay checks',async()=>{
 const token={},frames:any[]=[];let calls=0;
 const main=createMainCredentialBroker({ownerToken:token,maxPending:1,maxRequests:1,resolveCredential:async()=>{calls++;return new Promise(()=>{});},send:frame=>{frames.push(frame);}});main.setNegotiated(true);const grant=binding();main.setGrant(grant);
 const frame={protocolVersion:1,type:'credential-request',requestId:crypto.randomUUID(),grantId:grant.grantId,credentialRef:grant.credentialRef};
 expect(await main.handle(frame,token)).toBe(true);expect(await main.handle({...frame,requestId:crypto.randomUUID()},token)).toBe(false);
 const cancel={...frame,type:'credential-cancel'};expect(LocalCredentialCancelSchema.safeParse(cancel).success).toBe(true);expect(await main.handle({...cancel,grantId:'wrong'},token)).toBe(false);expect(await main.handle(cancel,token)).toBe(true);
 main.revoke(grant.grantId);main.setGrant(grant);expect(await main.handle(frame,token)).toBe(false);expect(await main.handle({...frame,requestId:crypto.randomUUID()},token)).toBe(false);expect(calls).toBe(1);main.close();
 const runtime=createRuntimeCredentialBroker({maxPending:1,send:()=>{}});runtime.setNegotiated(true);runtime.setGrant(grant);const pending=runtime.request(grant);await expect(runtime.request(grant)).rejects.toThrow('CREDENTIAL_RATE_LIMITED');
 for(let i=1;i<32;i++)runtime.setGrant({...grant,grantId:`g-${i}`});expect(()=>runtime.setGrant({...grant,grantId:'overflow'})).toThrow('CREDENTIAL_RATE_LIMITED');runtime.close();await expect(pending).rejects.toThrow('CREDENTIAL_CLOSED');
});
test('schema and transport errors never expose supplied error or malformed secret',async()=>{
 const request={protocolVersion:1,type:'credential-request',requestId:crypto.randomUUID(),grantId:'g',credentialRef:'r'};
 expect(LocalCredentialRequestSchema.safeParse({...request,secret:'forbidden'}).success).toBe(false);
 expect(LocalCredentialResponseSchema.safeParse({...request,type:'credential-response',ok:false,error:{code:'CREDENTIAL_UNAVAILABLE',message:'raw'}}).success).toBe(false);
 expect(LocalCredentialResponseSchema.safeParse({...request,type:'credential-response',ok:true,secret:' '.repeat(5)}).success).toBe(false);
 const p=pair({resolveCredential:async()=>''});try{await expect(p.runtime.request(p.grant)).rejects.toThrow('CREDENTIAL_UNAVAILABLE');}finally{p.close();}
 const broken=createRuntimeCredentialBroker({send:async()=>{throw Error('raw-key');}});broken.setNegotiated(true);const grant=binding();broken.setGrant(grant);
 await expect(broken.request(grant)).rejects.toThrow('CREDENTIAL_UNAVAILABLE');expect(broken.pendingCount).toBe(0);broken.close();
});
test('runtime rejects responses past the absolute timeout before delayed timer callbacks',async()=>{
 const frames:any[]=[];const runtime=createRuntimeCredentialBroker({timeoutMs:5,send:frame=>{frames.push(frame);}});runtime.setNegotiated(true);const grant=binding();runtime.setGrant(grant);
 try{const pending=runtime.request(grant);const until=Date.now()+25;while(Date.now()<until){/* deliberately block timer dispatch */}
 expect(runtime.receive({...frames[0],type:'credential-response',ok:true,secret:'late-secret'})).toBe(false);
 await expect(pending).rejects.toThrow('CREDENTIAL_TIMEOUT');expect(runtime.pendingCount).toBe(0);
 }finally{runtime.close();}
});
test('main never sends a resolver secret after its absolute timeout while timers are delayed',async()=>{
 const frames:any[]=[],token={};const main=createMainCredentialBroker({ownerToken:token,timeoutMs:5,send:frame=>{frames.push(frame);},resolveCredential:async()=>{
 const until=Date.now()+25;while(Date.now()<until){/* resolver blocks the event loop before resolving */}return 'late-secret';
 }});main.setNegotiated(true);const grant=binding();main.setGrant(grant);
 try{expect(await main.handle({protocolVersion:1,type:'credential-request',requestId:crypto.randomUUID(),grantId:grant.grantId,credentialRef:grant.credentialRef},token)).toBe(true);
 expect(frames).toHaveLength(1);expect(frames[0].ok).toBe(false);expect(frames[0].error.code).toBe('CREDENTIAL_TIMEOUT');expect(JSON.stringify(frames)).not.toContain('late-secret');expect(main.pendingCount).toBe(0);
 }finally{main.close();}
});
