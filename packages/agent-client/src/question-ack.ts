import { z } from 'zod';
import { MemoryIdentitySchema, WorkflowStoredRowSchema, WorkflowCommitReceiptSchema, QuestionPresentationRecordSchema,
 QuestionAckCommandSchema, QuestionAckDecisionSchema, type QuestionAckErrorCode } from '@interview/contracts';
import { workflowCommitDigest as digest } from './commit-validation.ts';

export class QuestionAcknowledgementError extends Error {
 constructor(readonly code:QuestionAckErrorCode){super(code);this.name='QuestionAcknowledgementError';}
}
function fail(code:QuestionAckErrorCode):never{throw new QuestionAcknowledgementError(code);}
function parse<T>(s:z.ZodType<T>,raw:unknown):T{const r=s.safeParse(raw);if(!r.success)fail('PRESENTATION_VALIDATION_ERROR');return r.data;}
const base={identity:MemoryIdentitySchema,stored:WorkflowStoredRowSchema,now:z.number().int().nonnegative()};
const input=z.object({...base,record:QuestionPresentationRecordSchema.nullable()}).strict();
function authorize(i:z.infer<typeof input>){
 const s=i.stored.workflow;
 if(i.identity.userId!==s.identity.userId||i.identity.roleId!==s.identity.roleId||i.record&&
  (i.record.identity.userId!==i.identity.userId||i.record.identity.roleId!==i.identity.roleId||i.record.packet.sessionId!==s.state.sessionId))fail('PRESENTATION_FORBIDDEN');
 if(i.record){
  if(digest(i.record.packet.text)!==i.record.packet.textDigest)fail('PRESENTATION_BINDING_INVALID');
  if(i.now<i.record.createdAt||i.record.acknowledgement&&i.now<i.record.acknowledgement.receivedAt)fail('PRESENTATION_CLOCK_INVALID');
 }
}
function unavailable(i:z.infer<typeof input>){
 const s=i.stored.workflow,r=i.record,c=s.issuedQuestions.at(-1)?.content;
 if(s.phase!=='awaiting_answer'||!s.current)return 'not-awaiting-answer' as const;
 if(!c)return 'legacy-content-missing' as const;
 if(!r)return 'unregistered' as const;
 if(i.now>=s.state.deadlineAt)return 'expired' as const;
 if(r.workflowDigest!==digest(s)||r.contentDigest!==digest(c)||r.packet.questionId!==s.current.question.id||r.packet.text!==c.text||
  r.packet.issuedAt!==s.currentIssuedAt||r.packet.expiresAt!==s.state.deadlineAt||r.planRunId!==c.planRunId||r.planAttemptId!==c.planAttemptId||
  r.originStorageVersion>i.stored.storageVersion)return 'stale' as const;
 return null;
}
/** Trusted API inputs only: schema/hash are consistency checks, not proof of a database commit. */
export function createQuestionPresentation(raw:unknown){
 const i=parse(z.object({...base,commitReceipt:WorkflowCommitReceiptSchema,deliveryId:z.string().min(1).max(100),existing:QuestionPresentationRecordSchema.nullable().default(null)}).strict(),raw);
 authorize({...i,record:i.existing});const s=i.stored.workflow,c=s.issuedQuestions.at(-1)?.content,r=i.commitReceipt;
 if(s.phase!=='awaiting_answer'||!s.current||!c)fail('PRESENTATION_BINDING_INVALID');
 if(i.now<s.currentIssuedAt!||i.now<r.appliedAt)fail('PRESENTATION_CLOCK_INVALID');
 if(i.now>=s.state.deadlineAt)fail('PRESENTATION_EXPIRED');
 if(r.userId!==i.identity.userId||r.roleId!==i.identity.roleId||r.sessionId!==s.state.sessionId||r.candidateDigest!==digest(s)||
  r.storageTo>i.stored.storageVersion||r.runId!==c.planRunId||r.attemptId!==c.planAttemptId)fail('PRESENTATION_BINDING_INVALID');
 if(i.existing){if(unavailable({...i,record:i.existing}))fail('PRESENTATION_STALE');return structuredClone(i.existing);}
 return parse(QuestionPresentationRecordSchema,{schemaVersion:1,identity:i.identity,packet:{deliveryId:i.deliveryId,sessionId:s.state.sessionId,
  questionId:s.current.question.id,roleId:s.state.roleId,text:c.text,textDigest:digest(c.text),issuedAt:s.currentIssuedAt,expiresAt:s.state.deadlineAt},
  workflowDigest:digest(s),contentDigest:digest(c),planRunId:c.planRunId,planAttemptId:c.planAttemptId,originStorageVersion:r.storageTo,
  createdAt:i.now,version:0,acknowledgement:null});
}
export function resumeQuestionPresentation(raw:unknown){
 const i=parse(input,raw);authorize(i);const reason=unavailable(i);
 if(reason)return{status:'unavailable' as const,reason,packet:null,receipt:null,shouldAcknowledge:false};
 const r=i.record!;return{status:r.acknowledgement?'acknowledged' as const:'awaiting-ack' as const,reason:null,
  packet:structuredClone(r.packet),receipt:structuredClone(r.acknowledgement),shouldAcknowledge:r.acknowledgement===null};
}
/** Returns a sidecar CAS candidate or exact prior receipt; performs no persistence or network I/O. */
export function prepareQuestionAcknowledgement(raw:unknown){
 const i=parse(z.object({...base,record:QuestionPresentationRecordSchema,command:QuestionAckCommandSchema}).strict(),raw);authorize(i);
 const r=i.record,c=i.command,p=r.packet;
 if(c.deliveryId!==p.deliveryId||c.sessionId!==p.sessionId||c.questionId!==p.questionId||c.textDigest!==p.textDigest)fail('PRESENTATION_BINDING_INVALID');
 if(r.acknowledgement){
  const {receivedAt:_a,confirmationSource:_b,...old}=r.acknowledgement;
  if(digest(old)!==digest(c))fail('PRESENTATION_OPERATION_CONFLICT');
  // Exact replay acknowledges prior work, even after progression; it never includes an actionable packet.
  return QuestionAckDecisionSchema.parse({kind:'question-ack-replay',committed:false,receipt:r.acknowledgement});
 }
 const reason=unavailable(i);if(reason)fail(reason==='expired'?'PRESENTATION_EXPIRED':'PRESENTATION_STALE');
 const receipt={...c,receivedAt:i.now,confirmationSource:'client-reported' as const};
 return QuestionAckDecisionSchema.parse({kind:'uncommitted-question-ack-plan',committed:false,
  where:{deliveryId:p.deliveryId,recordVersion:0,recordDigest:digest(r),storageVersion:i.stored.storageVersion,workflowDigest:digest(i.stored.workflow)},
  next:{...r,version:1,acknowledgement:receipt},receipt});
}
/** Opt-in API answer gate. Existing Agent endpoints do not enforce or persist this sidecar. */
export function requireQuestionAcknowledged(raw:unknown){
 const i=parse(input,raw),result=resumeQuestionPresentation(i);
 if(result.status==='unavailable')fail(result.reason==='expired'?'PRESENTATION_EXPIRED':'PRESENTATION_STALE');
 if(!result.receipt)fail('PRESENTATION_NOT_ACKNOWLEDGED');
 return{deliveryId:result.packet.deliveryId,questionId:result.packet.questionId,textDigest:result.packet.textDigest,receipt:result.receipt};
}
