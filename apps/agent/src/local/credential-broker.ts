import {randomUUID} from 'node:crypto';
import {LocalCredentialBindingSchema,LocalCredentialResponseSchema,LocalCredentialError,type LocalCredentialBinding,type LocalCredentialRequest,type LocalCredentialCancel,type LocalCredentialErrorCode} from '../../../../packages/contracts/src/local-credential.ts';

/** Runtime-only private pipe endpoint; keeps secrets only in the request's result closure. */
export function createRuntimeCredentialBroker(options:{send:(frame:LocalCredentialRequest|LocalCredentialCancel)=>void|Promise<void>;timeoutMs?:number;maxPending?:number;maxRequests?:number}){
 const timeoutMs=options.timeoutMs??15000,maxPending=options.maxPending??8,maxRequests=options.maxRequests??128;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||!Number.isInteger(maxPending)||maxPending<1||maxPending>32||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>1024)throw new LocalCredentialError('CREDENTIAL_INVALID');
 let negotiated=false,closed=false;
 const grants=new Map<string,LocalCredentialBinding>(),counts=new Map<string,number>();
 type Pending={frame:LocalCredentialRequest;deadline:number;resolve:(secret:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;cleanup:()=>void};
 const pending=new Map<string,Pending>();
 function sendCancel(frame:LocalCredentialRequest){try{void Promise.resolve(options.send({...frame,type:'credential-cancel'})).catch(()=>{});}catch{/* private transport failures have no raw error surface */}}
 function remove(requestId:string){const p=pending.get(requestId);if(!p)return;pending.delete(requestId);clearTimeout(p.timer);p.cleanup();return p;}
 function fail(requestId:string,code:LocalCredentialErrorCode,cancel=true){const p=remove(requestId);if(p){if(cancel)sendCancel(p.frame);p.reject(new LocalCredentialError(code));}}
 function revoke(grantId:string){grants.delete(grantId);for(const [id,p] of pending)if(p.frame.grantId===grantId)fail(id,'CREDENTIAL_REVOKED');}
 function setGrant(raw:LocalCredentialBinding){const p=LocalCredentialBindingSchema.safeParse(raw);if(!p.success)throw new LocalCredentialError('CREDENTIAL_INVALID');if(closed)throw new LocalCredentialError('CREDENTIAL_CLOSED');
  const g=p.data,old=grants.get(g.grantId);if(!old&&grants.size>=32||!counts.has(g.grantId)&&counts.size>=256)throw new LocalCredentialError('CREDENTIAL_RATE_LIMITED');
  if(old&&(old.credentialRef!==g.credentialRef||old.expiresAt!==g.expiresAt))revoke(g.grantId);grants.set(g.grantId,g);if(!counts.has(g.grantId))counts.set(g.grantId,0);
 }
 function request(binding:Pick<LocalCredentialBinding,'grantId'|'credentialRef'>,opts:{signal?:AbortSignal}={}):Promise<string>{
  if(closed)return Promise.reject(new LocalCredentialError('CREDENTIAL_CLOSED'));if(!negotiated)return Promise.reject(new LocalCredentialError('CREDENTIAL_NOT_NEGOTIATED'));
  const grant=grants.get(binding.grantId);if(!grant||grant.credentialRef!==binding.credentialRef||grant.expiresAt<=Date.now())return Promise.reject(new LocalCredentialError('CREDENTIAL_REVOKED'));
  if(opts.signal?.aborted)return Promise.reject(new LocalCredentialError('CREDENTIAL_CANCELLED'));
  const used=counts.get(grant.grantId)??0;if(pending.size>=maxPending||used>=maxRequests)return Promise.reject(new LocalCredentialError('CREDENTIAL_RATE_LIMITED'));
  counts.set(grant.grantId,used+1);const frame:LocalCredentialRequest={protocolVersion:1,type:'credential-request',requestId:randomUUID(),grantId:grant.grantId,credentialRef:grant.credentialRef};
  return new Promise((resolve,reject)=>{const now=Date.now(),deadline=Math.min(now+timeoutMs,grant.expiresAt),delay=Math.max(1,deadline-now);const abort=()=>fail(frame.requestId,'CREDENTIAL_CANCELLED');
   const timer=setTimeout(()=>fail(frame.requestId,Date.now()>=grant.expiresAt?'CREDENTIAL_REVOKED':'CREDENTIAL_TIMEOUT'),delay);
   pending.set(frame.requestId,{frame,deadline,resolve,reject,timer,cleanup:()=>opts.signal?.removeEventListener('abort',abort)});opts.signal?.addEventListener('abort',abort,{once:true});
   try{void Promise.resolve(options.send(frame)).catch(()=>fail(frame.requestId,'CREDENTIAL_UNAVAILABLE',false));}catch{fail(frame.requestId,'CREDENTIAL_UNAVAILABLE',false);}
  });
 }
 function receive(raw:unknown):boolean{if(closed||!negotiated)return false;const parsed=LocalCredentialResponseSchema.safeParse(raw);if(!parsed.success)return false;const frame=parsed.data,p=pending.get(frame.requestId);
  if(!p||p.frame.grantId!==frame.grantId||p.frame.credentialRef!==frame.credentialRef)return false;
  const grant=grants.get(frame.grantId);if(!grant||grant.credentialRef!==frame.credentialRef||grant.expiresAt<=Date.now()){fail(frame.requestId,'CREDENTIAL_REVOKED');return false;}
  if(Date.now()>=p.deadline){fail(frame.requestId,'CREDENTIAL_TIMEOUT');return false;}
  remove(frame.requestId);if(frame.ok)p.resolve(frame.secret);else p.reject(new LocalCredentialError(frame.error.code));return true;
 }
 return{setGrant,revoke,request,receive,get pendingCount(){return pending.size;},setNegotiated(value:boolean){negotiated=value;if(!value)for(const id of pending.keys())fail(id,'CREDENTIAL_NOT_NEGOTIATED');},close(){if(closed)return;closed=true;for(const id of pending.keys())fail(id,'CREDENTIAL_CLOSED');grants.clear();counts.clear();}};
}
