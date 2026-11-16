import { createHash } from 'node:crypto';
import { TurnInputSchema,type TurnInput } from '../../../../packages/contracts/src/evaluation.ts';
import { ClarificationOptionsSchema,ClarificationPolicySchema,UnscoredTurnSchema,NEUTRAL_CLARIFICATION_PROMPT,OBSERVATION_CLARIFICATION_PROMPT,type TurnResolution,type UnscoredTurn } from '../../../../packages/contracts/src/clarification.ts';
import {observationClarificationEligible,validClarificationPrompt} from '../../../../packages/interview-domain/src/clarification.ts';
import { assessTurn,type EvaluationDependencies } from './evaluate-turn.ts';
import { AgentStateError } from '../planning/interview-state.ts';
const prompt=NEUTRAL_CLARIFICATION_PROMPT;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function binding(i:TurnInput){const{answer,context,speech,...frozen}=i;return hash(JSON.stringify({...frozen,userId:context.userId,roleId:context.roleId}));}
/** Integrity/replay check only. Ownership and retention/CAS remain host responsibilities. */
export function validateClarificationReceipt(i:TurnInput,r:UnscoredTurn){
 const {digest,...body}=r;
 if(hash(JSON.stringify(body))!==digest||r.inputDigest!==binding(i)||r.answerDigest!==hash(i.answer.text)||r.answerCharacters!==i.answer.text.length
  ||JSON.stringify(r.basedOn)!==JSON.stringify({sessionId:i.state.sessionId,sessionVersion:i.expectedVersion,runId:i.context.runId,attemptId:i.context.attemptId,answerId:i.answer.id,questionId:i.question.id})
  ||r.observationId!==i.observationId||r.issuedAt<i.state.startedAt||r.issuedAt>=Math.min(i.context.deadlineAt,i.state.deadlineAt)
  ||r.remainingSeconds!==Math.max(0,Math.floor((i.state.deadlineAt-r.issuedAt)/1000))
  ||r.missingCriterionIds.some(id=>!i.rubric.criteria.some(c=>c.id===id))||!validClarificationPrompt(i,r))throw new AgentStateError('VALIDATION_ERROR');
}
export function validateClarificationContinuation(i:TurnInput,previous:UnscoredTurn,at:number){
 if(previous.status!=='needs_clarification'||previous.inputDigest!==binding(i)||i.answer.id===previous.basedOn.answerId||i.context.runId===previous.basedOn.runId
  ||i.answer.text.length<=previous.answerCharacters||!i.answer.text.slice(previous.answerCharacters).trim()
  ||hash(i.answer.text.slice(0,previous.answerCharacters))!==previous.answerDigest||at<previous.issuedAt)throw new AgentStateError('VERSION_CONFLICT');
}
/** SHA consistency is not authorization: the API must retain the latest receipt and enforce CAS/ownership. */
export async function evaluateTurnWithClarification(rawInput:unknown,deps:EvaluationDependencies,rawOptions:unknown={}):Promise<TurnResolution>{
 const input=TurnInputSchema.safeParse(rawInput),config=ClarificationOptionsSchema.safeParse(rawOptions);
 if(!input.success||!config.success)throw new AgentStateError('VALIDATION_ERROR');
 const i=input.data,previous=config.data.previous,policy=config.data.policy??previous?.policy??ClarificationPolicySchema.parse({});
 let attempt=0;
 if(previous){
  const{digest,...body}=previous;
  if(previous.status!=='needs_clarification'||hash(JSON.stringify(body))!==digest||!validClarificationPrompt(i,previous,i.answer.text.slice(0,previous.answerCharacters))||previous.inputDigest!==binding(i)
   ||JSON.stringify(policy)!==JSON.stringify(previous.policy)||i.answer.id===previous.basedOn.answerId||i.context.runId===previous.basedOn.runId
   ||i.answer.text.length<=previous.answerCharacters||!i.answer.text.slice(previous.answerCharacters).trim()
   ||hash(i.answer.text.slice(0,previous.answerCharacters))!==previous.answerDigest||(deps.now??Date.now)()<previous.issuedAt)
   throw new AgentStateError('VERSION_CONFLICT');
  attempt=previous.attempt;
 }
 const now=deps.now??Date.now;
 const result=await assessTurn(i,{...deps,now:()=>{const at=now();if(previous&&at<previous.issuedAt)throw new AgentStateError('VALIDATION_ERROR');return at;}},true);
 if(result.kind!=='validated-insufficient-score')return{status:'scored',proposal:result};
 const at=result.at,remainingSeconds=Math.max(0,Math.floor((i.state.deadlineAt-at)/1000));
 const reason=remainingSeconds<policy.minRemainingSeconds?'time_budget':attempt>=policy.maxClarifications?'clarification_limit':'evidence_insufficient';
 const needs=reason==='evidence_insufficient';
 const targeted=needs&&observationClarificationEligible(i,result.score.missingDimensions);
 const body={kind:'uncommitted-unscored-turn',status:needs?'needs_clarification':'abstained',
  basedOn:{sessionId:i.state.sessionId,sessionVersion:i.expectedVersion,runId:i.context.runId,attemptId:i.context.attemptId,answerId:i.answer.id,questionId:i.question.id},
  observationId:i.observationId,inputDigest:binding(i),answerDigest:hash(i.answer.text),answerCharacters:i.answer.text.length,policy,attempt:attempt+(needs?1:0),remainingSeconds,
  issuedAt:at,missingCriterionIds:result.score.missingDimensions,normalizedScore:null,clarification:needs?(targeted?OBSERVATION_CLARIFICATION_PROMPT:prompt):null,reason,
  ...(targeted?{clarificationTemplate:'observation-v1' as const}:{})};
 return UnscoredTurnSchema.parse({...body,digest:hash(JSON.stringify(body))});
}
