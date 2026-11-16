import {readFileSync,writeFileSync} from 'node:fs';
import {createDurableLiveRunManager} from '../../apps/agent/src/runtime/durable-runtime.ts';
import {continuationRequest,fixtureStream} from './fixture.ts';
import {contentHash} from '../../evals/answers/validation.ts';
try{
 const p=JSON.parse(readFileSync(process.argv[2]!,'utf8'));let httpAttempts=0,credentialReads=0,firstResultDigest='',firstBudgetDigest='';
 const r=createDurableLiveRunManager(p.config,{readCredential:()=>{credentialReads++;return 'synthetic-only';},fetch:async()=>{
  httpAttempts++;
  if(httpAttempts===2){
   const dispatched=r.modelAccounting().find(s=>s.entries.some(e=>e.status==='dispatched'));
   if(!dispatched)throw Error();
   writeFileSync(p.metrics,JSON.stringify({httpAttempts,credentialReads,firstResultDigest,firstBudgetDigest,heldTokens:dispatched.totals.heldTokens}));
   process.exit(23);
  }
  return fixtureStream(p.output);
 }},{path:p.database,ownerId:'inflight-child',leaseMs:10000});
 r.start(p.request);await r.wait(p.request.context.runId);const pending=r.snapshot(p.request.context.runId);
 if(pending.status!=='completed'||pending.result?.kind!=='uncommitted-unscored-turn-result'||pending.result.resolution.status!=='needs_clarification')throw Error();
 firstResultDigest=contentHash(pending);firstBudgetDigest=contentHash(r.modelAccounting()[0]);
 const continuation=continuationRequest(p.request,pending.result.resolution);writeFileSync(p.continuation,JSON.stringify(continuation));
 r.start(continuation.request);await r.wait(continuation.request.context.runId);process.exit(99);
}catch{console.error('INFLIGHT_CLARIFICATION_CHILD_FAILED');process.exit(2);}
