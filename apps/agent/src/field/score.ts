import{join,dirname}from'node:path';import{randomUUID,createHash}from'node:crypto';
import{LiveServiceConfigSchema}from'../../../../packages/contracts/src/live-model.ts';import{createDurableLiveRunManager}from'../runtime/durable-runtime.ts';
import{openSessionAccounting}from'../accounting/session-ledger.ts';import{createSessionCheckpointAdapter}from'../accounting/checkpoint-adapter.ts';
import type{LiveModelDependencies}from'../model-access/bailian-provider.ts';import type{FieldSession}from'./session.ts';
/** Operator CLI only: no API/desktop, no retries, no synthetic human data. */
export async function scoreFieldSession(session:FieldSession,rawConfig:unknown,deps:Pick<LiveModelDependencies,'readCredential'|'fetch'>){
 if(!session.status().humanAnswers)throw Error('FIELD_ANSWERS_REQUIRED');
 const source=LiveServiceConfigSchema.parse(rawConfig),at=Date.now();if(!source.authorization.enabled||!source.authorization.operatorApproved||source.authorization.expiresAt<=at||source.authorization.expiresAt>at+600000)throw Error('FIELD_LIVE_AUTH_REQUIRED');
 const c=LiveServiceConfigSchema.parse({...source,authorization:{...source.authorization,maxRuns:16},planning:'deterministic',questionDelivery:'canonical',
  recovery:{httpMaxAttempts:1,maxModelRepairs:0,baseDelayMs:250,maxDelayMs:3000},profile:{...source.profile,limits:{...source.profile.limits,maxCalls:1,maxConcurrent:1,maxCostMicros:1000000}}});
 const m=session.manifest(),base=dirname(session.path),ledger=openSessionAccounting(join(base,'field-budget.sqlite'));ledger.recoverExpired();
 const sid=(role:string)=>`${m.studyId}.${role}`;
 for(const role of ['java-backend','web-frontend']){let old;try{old=ledger.snapshot(sid(role));}catch{}
  ledger.ensureSession({sessionId:sid(role),userId:m.participantId,roleId:role,currency:c.profile.pricing.currency,maxCostMicros:1000000,maxCalls:8,maxConcurrent:1,deadlineAt:old?.policy.deadlineAt??at+3600000});}
 const adapters=new Map<string,ReturnType<typeof createSessionCheckpointAdapter>>();
 const adapter=(context:{runId:string;userId:string;roleId:string})=>{let a=adapters.get(context.runId);if(!a){a=createSessionCheckpointAdapter({ledger,binding:{sessionId:sid(context.roleId),userId:context.userId,roleId:context.roleId,runId:context.runId},pricing:{source:`${c.profile.pricing.provenance}:${c.profile.modelId}`,version:c.profile.pricing.version,unit:'token'}});adapters.set(context.runId,a);}return a;};
 let httpAttempts=0;const fetcher=deps.fetch??globalThis.fetch;
 const runtime=createDurableLiveRunManager(c,{...deps,fetch:async(input,init)=>{httpAttempts++;return fetcher(input,init);},canDispatchRun:ctx=>{const state=ledger.snapshot(sid(ctx.roleId));return !state.locked&&!state.entries.some(e=>e.status==='unknown');},
  onBudgetCheckpoint:(ctx,s)=>adapter(ctx).model(s)},{path:join(base,'field-runs.sqlite'),ownerId:randomUUID()});
 const outcomes:{questionId:string;status:string;errorCode?:string;replayed?:boolean}[]=[];
 try{all:for(const role of ['java-backend','web-frontend']as const)for(const q of session.questions(role)){
  if(!q.answered)continue;
  const saved=session.scoreSnapshot(q.id);
  if(saved){outcomes.push({questionId:q.id,status:saved.status,replayed:true,...(saved.error?{errorCode:saved.error.code}:{})});continue;}
  // Reuse the original request and durable ID. A completed result needs no key/network.
  const req=session.scoringRequest(q.id,Math.min(c.authorization.expiresAt,Date.now()+60000));
  for(const snapshot of runtime.modelAccounting())if(snapshot.scope.roleId===role&&snapshot.entries.some(e=>e.status==='unknown'||e.status==='released')){
   // Each snapshot uses pseudonymous runId: only map the matching persisted request.
   const hash=createHash('sha256').update(req.context.runId).digest('hex').slice(0,40);
   if(snapshot.scope.runId===hash)adapter(req.context).model(snapshot);
  }
  runtime.start(req);await runtime.wait(req.context.runId);const result=runtime.snapshot(req.context.runId);
  await session.saveScore(q.id,result,deps.fetch?'injected-http':'live-http');outcomes.push({questionId:q.id,status:result.status,...(result.error?{errorCode:result.error.code}:{})});
  // A rejected output is an independent case failure, never a retry. Unknown
  // consumption still stops admission across the batch.
  if(result.status!=='completed'&&(['java-backend','web-frontend'].some(r=>{const x=ledger.snapshot(sid(r));return x.locked||x.entries.some(e=>e.status==='unknown');})))break all;
 }
 return{outcomes,accounting:['java-backend','web-frontend'].map(r=>ledger.snapshot(sid(r))),httpAttemptsThisInvocation:httpAttempts,liveModelCalls:deps.fetch?0:httpAttempts,
  evaluationDiagnostics:runtime.evaluationDiagnostics(),recoveryDiagnostics:runtime.recoveryDiagnostics(),
  networkMode:deps.fetch?'injected-http':'live-http',vendorBillingVerified:false,qualityVerified:false};
 }finally{await runtime.shutdown({graceMs:500,cancelWaitMs:1000});runtime.close();ledger.close();}
}
