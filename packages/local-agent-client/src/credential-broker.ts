import {LocalCredentialBindingSchema,LocalCredentialRequestSchema,LocalCredentialCancelSchema,LocalCredentialResponseSchema,LocalCredentialError,type LocalCredentialBinding,type LocalCredentialRequest,type LocalCredentialResponse,type LocalCredentialErrorCode} from '../../contracts/src/local-credential.ts';

export type LocalCredentialResolver=(context:{grantId:string;credentialRef:string;requestId:string;signal:AbortSignal})=>Promise<string|undefined>;
/** Main-process only. ownerToken must be the identity captured for the owned child pipe. */
export function createMainCredentialBroker(options:{ownerToken:object;send:(frame:LocalCredentialResponse)=>void|Promise<void>;resolveCredential:LocalCredentialResolver;timeoutMs?:number;maxPending?:number;maxRequests?:number}){
 const timeoutMs=options.timeoutMs??15000,maxPending=options.maxPending??8,maxRequests=options.maxRequests??128;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isInteger(maxPending)||maxPending<1||maxPending>32||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>1024)throw new LocalCredentialError('CREDENTIAL_INVALID');
 let negotiated=false,closed=false;
 const grants=new Map<string,LocalCredentialBinding>(),seen=new Map<string,Set<string>>();
 type Pending={frame:LocalCredentialRequest;deadline:number;controller:AbortController;timer:ReturnType<typeof setTimeout>};const pending=new Map<string,Pending>();
 function remove(id:string){const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);return p;}
 function send(frame:LocalCredentialResponse){try{void Promise.resolve(options.send(frame)).catch(()=>{});}catch{/* never forward resolver or pipe errors */}}
 function fail(id:string,code:LocalCredentialErrorCode,respond=true){const p=remove(id);if(!p)return;p.controller.abort();if(respond)send({...p.frame,type:'credential-response',ok:false,error:{code}});}
 function revoke(grantId:string){grants.delete(grantId);for(const [id,p] of pending)if(p.frame.grantId===grantId)fail(id,'CREDENTIAL_REVOKED');}
 function setGrant(raw:LocalCredentialBinding){const parsed=LocalCredentialBindingSchema.safeParse(raw);if(!parsed.success)throw new LocalCredentialError('CREDENTIAL_INVALID');if(closed)throw new LocalCredentialError('CREDENTIAL_CLOSED');const g=parsed.data,old=grants.get(g.grantId);
  if(!old&&grants.size>=32||!seen.has(g.grantId)&&seen.size>=256)throw new LocalCredentialError('CREDENTIAL_RATE_LIMITED');if(old&&(old.credentialRef!==g.credentialRef||old.expiresAt!==g.expiresAt))revoke(g.grantId);grants.set(g.grantId,g);if(!seen.has(g.grantId))seen.set(g.grantId,new Set());
 }
 async function resolve(frame:LocalCredentialRequest,entry:Pending){
  try{const secret=await options.resolveCredential({grantId:frame.grantId,credentialRef:frame.credentialRef,requestId:frame.requestId,signal:entry.controller.signal});
   if(pending.get(frame.requestId)!==entry)return;const grant=grants.get(frame.grantId);if(!negotiated||closed||!grant||grant.credentialRef!==frame.credentialRef||grant.expiresAt<=Date.now()){fail(frame.requestId,'CREDENTIAL_REVOKED');return;}
   if(Date.now()>=entry.deadline){fail(frame.requestId,'CREDENTIAL_TIMEOUT');return;}
   const response=LocalCredentialResponseSchema.safeParse({...frame,type:'credential-response',ok:true,secret});if(!response.success){fail(frame.requestId,'CREDENTIAL_UNAVAILABLE');return;}remove(frame.requestId);send(response.data);
  }catch{if(pending.get(frame.requestId)===entry)fail(frame.requestId,'CREDENTIAL_UNAVAILABLE');}
 }
 async function handle(raw:unknown,sourceToken:object):Promise<boolean>{
  if(closed||!negotiated||sourceToken!==options.ownerToken)return false;
  const cancelled=LocalCredentialCancelSchema.safeParse(raw);if(cancelled.success){const c=cancelled.data,p=pending.get(c.requestId);if(!p||p.frame.grantId!==c.grantId||p.frame.credentialRef!==c.credentialRef)return false;fail(c.requestId,'CREDENTIAL_CANCELLED',false);return true;}
  const parsed=LocalCredentialRequestSchema.safeParse(raw);if(!parsed.success)return false;const frame=parsed.data,grant=grants.get(frame.grantId),used=seen.get(frame.grantId);
  if(!grant||grant.credentialRef!==frame.credentialRef||grant.expiresAt<=Date.now()||!used||used.has(frame.requestId)||pending.has(frame.requestId)||pending.size>=maxPending||used.size>=maxRequests)return false;
  used.add(frame.requestId);const controller=new AbortController(),now=Date.now(),deadline=Math.min(now+timeoutMs,grant.expiresAt),delay=Math.max(1,deadline-now);
  const entry:Pending={frame,deadline,controller,timer:setTimeout(()=>fail(frame.requestId,Date.now()>=grant.expiresAt?'CREDENTIAL_REVOKED':'CREDENTIAL_TIMEOUT'),delay)};pending.set(frame.requestId,entry);void resolve(frame,entry);return true;
 }
 return{setGrant,revoke,handle,get pendingCount(){return pending.size;},setNegotiated(value:boolean){negotiated=value;if(!value)for(const id of pending.keys())fail(id,'CREDENTIAL_NOT_NEGOTIATED');},close(){if(closed)return;closed=true;for(const id of pending.keys())fail(id,'CREDENTIAL_CLOSED',false);grants.clear();seen.clear();}};
}
