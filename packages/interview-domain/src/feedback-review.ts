import {createHash} from 'node:crypto';
import {TurnInputSchema,TurnProposalSchema} from '../../contracts/src/evaluation.ts';
import {ScoringContextSchema} from '../../contracts/src/scoring.ts';

// Deliberately not a general semantic verifier. This development arithmetic fixture
// is tied to an exact development question and rubric; unknown prose stays unknown.
export const capacityProfile={id:'java-capacity-remaining-v1',roleId:'java-backend',questionId:'java-project-capacity',
 version:'seed-0.5-observation-draft',questionDigest:'f7583734c4581d09261e4273b10abdabd99c85d6036096bb5187802cf8401dd0',
 rubricDigest:'10be95e307cd2bd1e2ea4ee6c817cd3138ca527cf9fe55d58e872ad97a28dc10',
 upper:100,initial:99,assumptions:'单轮、无归还或重试、正确原子实现；不约束不安全实现的实际成功数',reviewStatus:'development-draft'} as const;
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`;
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export function reviewCapacityClaim(text:string):{status:'not-covered'}|{status:'contradiction'|'matched-restricted-claim';expected:number;observed:number}{
 // Whole item, one explicit assertion. Only a known correction instruction is
 // allowed as suffix; arbitrary negation, quotation or qualification stays unknown.
 const match=/^(?:初值99时)?(?:正确最大成功数应为|剩余名额应为)(\d{1,6})(?:而非\d{1,6})?[。.]?(?:[；;]需修正该数值错误并解释为何不能超额到\d{1,6})?$/u.exec(text);
 if(!match)return {status:'not-covered'};
 const observed=Number(match[1]),expected=capacityProfile.upper-capacityProfile.initial;
 return {status:observed===expected?'matched-restricted-claim':'contradiction',expected,observed};
}
export function reviewFeedback(rawInput:unknown,rawProposal:unknown){
 const input=TurnInputSchema.parse(rawInput),proposal=TurnProposalSchema.parse(rawProposal),b=proposal.basedOn;
 if(b.sessionId!==input.state.sessionId||b.sessionVersion!==input.expectedVersion||b.runId!==input.context.runId||b.attemptId!==input.context.attemptId||b.answerId!==input.answer.id||b.questionId!==input.question.id||proposal.evaluation.answerId!==input.answer.id||proposal.evaluation.rubricId!==input.rubric.id||proposal.evaluation.rubricVersion!==input.rubric.version)throw Error('FEEDBACK_REVIEW_BINDING_INVALID');
 ScoringContextSchema.parse({...input.context,answerId:input.answer.id,answerText:input.answer.text,evidence:proposal.evidence});
 const profileMatched=input.context.roleId===capacityProfile.roleId&&input.question.roleId===capacityProfile.roleId&&input.question.id===capacityProfile.questionId&&input.rubric.version===capacityProfile.version&&hash(input.question.text)===capacityProfile.questionDigest&&hash(input.rubric)===capacityProfile.rubricDigest;
 const candidateEvidence=proposal.evidence.map(e=>({id:e.id,excerpt:e.excerpt}));
 const items=(['strengths','improvements'] as const).flatMap(kind=>proposal.feedback[kind].map((text,index)=>({kind,index,text,
  fact:profileMatched?reviewCapacityClaim(text):{status:'not-covered' as const},
  citationSupport:'independent-review-required' as const,candidateEvidence,
  concern:kind==='strengths'&&/竞争|竞态|并发窗口/.test(text)&&!/竞争|竞态|并发窗口/.test(input.answer.text)?'race-awareness-without-literal-answer-cue' as const:null})));
 return {version:1 as const,profile:profileMatched?capacityProfile:null,questionId:input.question.id,answerId:input.answer.id,items,
  status:items.some(i=>i.fact.status==='contradiction')?'blocked-fact-contradiction' as const:'pending-independent-review' as const,
  qualityClaimEligible:false as const,humanReferenceCount:0 as const,liveModelCalls:0 as const,originalProposalChanged:false as const};
}
