import { QuestionAckDecisionSchema, QuestionPresentationRecordSchema, WorkflowStoredRowSchema } from '../../packages/contracts/src/index.ts';
import { prepareQuestionAcknowledgement, QuestionAcknowledgementError } from '../../packages/agent-client/src/question-ack.ts';
import { workflowCommitDigest as digest } from '../../packages/agent-client/src/workflow-commit.ts';
function fail(code:ConstructorParameters<typeof QuestionAcknowledgementError>[0]):never{throw new QuestionAcknowledgementError(code);}

/** Private single-process CAS simulation. No durable storage, authentication, or database transactions. */
export function createQuestionAckFixtureStore(raw:unknown,getStored:()=>unknown){
 let record=QuestionPresentationRecordSchema.parse(raw);
 const admitted=new Set<string>();
 const current=()=>structuredClone(record);
 function prepare(command:unknown,now:number){
  const plan=prepareQuestionAcknowledgement({identity:record.identity,stored:getStored(),record,command,now});
  admitted.add(digest(plan));return plan;
 }
 function apply(rawDecision:unknown,now:number,options:{failBeforeCommit?:boolean}={}){
  if(!Number.isSafeInteger(now)||now<record.createdAt||record.acknowledgement&&now<record.acknowledgement.receivedAt)fail('PRESENTATION_CLOCK_INVALID');
  // Reject caller-edited candidates even if their public schema remains valid.
  if(!admitted.has(digest(rawDecision)))fail('PRESENTATION_BINDING_INVALID');
  const d=QuestionAckDecisionSchema.parse(rawDecision);
  if(record.acknowledgement){
   if(digest(d.receipt)!==digest(record.acknowledgement))fail('PRESENTATION_OPERATION_CONFLICT');
   return{effect:'replayed-in-memory' as const,formalCommitted:false as const,receipt:structuredClone(record.acknowledgement)};
  }
  if(d.kind!=='uncommitted-question-ack-plan'||d.where.recordVersion!==record.version||d.where.recordDigest!==digest(record))fail('PRESENTATION_STALE');
  const stored=WorkflowStoredRowSchema.parse(getStored());
  if(stored.storageVersion!==d.where.storageVersion||digest(stored.workflow)!==d.where.workflowDigest)fail('PRESENTATION_STALE');
  if(now<d.receipt.receivedAt)fail('PRESENTATION_CLOCK_INVALID');
  if(now>=record.packet.expiresAt)fail('PRESENTATION_EXPIRED');
  if(options.failBeforeCommit)throw new Error('ACK_FIXTURE_ABORT');
  // Single synchronous swap is a simulation, not a proof of SQL atomicity.
  record=structuredClone(d.next);
  return{effect:'applied-in-memory' as const,formalCommitted:false as const,receipt:structuredClone(record.acknowledgement!)};
 }
 return{prepare,apply,current};
}
