import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AsrAccountingSchema} from '../../../../packages/contracts/src/asr-service.ts';
import {ModelBudgetSnapshotSchema} from '../../../../packages/contracts/src/model-access.ts';
import {SessionPricingProvenanceSchema} from '../../../../packages/contracts/src/session-accounting.ts';
import type {SessionAccounting} from './session-ledger.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const fail=(s:string):never=>{throw Error(s);};
/** Host-only bridge: wire as onCheckpoint BEFORE the provider makes its first HTTP request. */
export function createSessionCheckpointAdapter(options:{ledger:SessionAccounting;
 binding:{sessionId:string;userId:string;roleId:string;runId:string};pricing:z.infer<typeof SessionPricingProvenanceSchema>}){
 const {ledger}=options,binding=z.object({sessionId:z.string().min(1),userId:z.string().min(1),roleId:z.string().min(1),runId:z.string().min(1)}).strict().parse(options.binding),
  pricing=SessionPricingProvenanceSchema.parse(options.pricing);
 const policy=ledger.snapshot(binding.sessionId).policy;
 if(policy.userId!==binding.userId||policy.roleId!==binding.roleId)fail('SESSION_FORBIDDEN');
 const attemptId=(kind:'asr'|'llm'|'tts',callId:string)=>`${kind}-${hash(JSON.stringify([binding.runId,callId]))}`;
 function checkpoint(kind:'asr'|'llm',callId:string,cost:number,status:'reserved'|'dispatched'|'unknown'|'responded'|'released'|'settled',usage?:{actualCostMicros:number;evidence:unknown}){
  const id=attemptId(kind,callId),current=()=>ledger.snapshot(binding.sessionId).entries.find(e=>e.attemptId===id);
  let entry=current();
  // Terminal snapshots without a preceding reservation are not proof of pre-dispatch admission.
  if(!entry){if(status!=='reserved'&&!(kind==='asr'&&status==='dispatched'))fail('SESSION_CHECKPOINT_MISSING');
   ledger.reserve({sessionId:binding.sessionId,userId:binding.userId,roleId:binding.roleId,operationId:id,attemptId:id,kind,
    reservedCostMicros:Math.max(1,cost),pricing});entry=current()!;}
  if(entry.reservedCostMicros!==Math.max(1,cost))fail('SESSION_CHECKPOINT_CONFLICT');
  if(entry.status===status&&status!=='settled')return;
  if(status==='reserved'){if(entry.status!=='reserved')fail('SESSION_STATE_CONFLICT');return;}
  if(status==='released'){if(entry.status!=='released')ledger.release(binding.sessionId,id);return;}
  if(entry.status==='reserved')ledger.dispatch(binding.sessionId,id);
  if(status==='dispatched'){if(current()!.status!=='dispatched')fail('SESSION_REPLAY_BLOCKED');return;}
  if(status==='unknown'){ledger.markUnknown(binding.sessionId,id);return;}
  if(status==='responded'){ledger.completeResponse(binding.sessionId,id);return;}
  const confirmed=usage??fail('SESSION_CHECKPOINT_MISSING'),encoded=JSON.stringify(confirmed.evidence);
  ledger.reconcile({sessionId:binding.sessionId,attemptId:id,expectedVersion:ledger.snapshot(binding.sessionId).version,reconciliationId:`usage-${id}`,
   actualCostMicros:confirmed.actualCostMicros,evidence:{kind:'host-usage',reference:`checkpoint:${binding.runId}:${callId}`.slice(0,500),sha256:hash(encoded)}});
 }
 return {attemptId,
  asr(raw:unknown){const s=AsrAccountingSchema.parse(raw);
   if(s.context.userId!==binding.userId||s.context.roleId!==binding.roleId||s.context.runId!==binding.runId)fail('SESSION_FORBIDDEN');
   for(const e of s.entries)checkpoint('asr',e.callId,e.reservedCostMicros,e.status==='rejected'?'responded':e.status);
  },
  model(raw:unknown){const s=ModelBudgetSnapshotSchema.parse(raw),matches=(actual:string,expected:string)=>actual===expected||actual===hash(expected).slice(0,40);
   if(!matches(s.scope.userId,binding.userId)||s.scope.roleId!==binding.roleId||!matches(s.scope.runId,binding.runId))fail('SESSION_FORBIDDEN');
   if(s.currency!==policy.currency)fail('SESSION_CURRENCY_CONFLICT');
   for(const e of s.entries)checkpoint('llm',e.callId,e.reservedCostMicros,e.status==='rejected'?'responded':e.status,
    e.status==='settled'?{actualCostMicros:e.actualCostMicros??fail('SESSION_CHECKPOINT_MISSING'),evidence:{usage:e.usage,profileDigest:s.profileDigest,pricing}}:undefined);
  },
 };
}
