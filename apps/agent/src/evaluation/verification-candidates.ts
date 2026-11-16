import {createHash} from 'node:crypto';
import {RubricSchema} from '../../../../packages/contracts/src/scoring.ts';
import {VerificationCandidateCatalogSchema,type VerificationCandidateCatalog} from '../../../../packages/contracts/src/verification-candidates.ts';
import {AgentStateError} from '../planning/interview-state.ts';
type Part='action'|'target'|'expectation'|'metric'|'value'|'condition';
type Span={start:number;end:number};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const boundary=/[。；;!?！？\r\n]/;
const clause=/[，,。；;!?！？\r\n]/;
const number='[-+]?(?:\\d+(?:\\.\\d+)?|[零一二三四五六七八九十百千万两]+)';
const count=new RegExp('^(?:(?:最多|至少|不超过|不低于|不超|不小于|少于|多于|等于|为|是|<=|>=|==|=|<|>|≤|≥|at most|at least|less than|more than|no more than|equal to)\\s*)?'+number+'(?:\\s*(?:个|次|条))?(?![\\dA-Za-z.%])','i');
const duration=new RegExp('^(?:'+number+'\\s*(?:ms|毫秒|s|秒|us|μs|微秒)|(?:减少|下降|降低|增加|上升|升高|不变|变快|变慢)(?:\\s*\\d+(?:\\.\\d+)?\\s*%)?|(?:decrease|increase|unchanged)(?:\\s*\\d+(?:\\.\\d+)?\\s*%)?)(?![\\dA-Za-z.%])','i');
function unique(spans:Span[]){return [...new Map(spans.map(s=>[s.start+':'+s.end,s])).values()].sort((a,b)=>a.start-b.start||b.end-a.end);}
function literals(text:string,aliases:readonly string[]):Span[]{const spans=new Map<string,Span>();for(const alias of aliases)for(const m of text.matchAll(new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu'))){
 const s={start:m.index,end:m.index+m[0].length};spans.set(s.start+':'+s.end,s);if(spans.size>16)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
 }return unique([...spans.values()]);}
function isBoundary(text:string,at:number,separators:RegExp){const char=text[at]!;return separators.test(char)||char==='.'&&!( /\d/.test(text[at-1]??'')&&/\d/.test(text[at+1]??''));}
export function hasVerificationSentenceBoundary(text:string,start:number,end:number){for(let i=start;i<end;i++)if(isBoundary(text,i,boundary))return true;return false;}
function enclosing(text:string,start:number,end:number,separators:RegExp){while(start>0&&!isBoundary(text,start-1,separators))start--;while(end<text.length&&!isBoundary(text,end,separators))end++;while(start<end&&/\s/.test(text[start]!))start++;while(end>start&&/\s/.test(text[end-1]!))end--;return{start,end};}
function supportedValueEnd(rest:string){const next=rest.replace(/^[ \t]*/,'');
 // Never accept a parseable prefix of a magnitude, thousands grouping or qualified percentage.
 if(/^[,，][ \t]*[-+]?(?:\d|[零一二三四五六七八九十百千万亿两])/.test(next))return false;
 return next===''||/^(?:[，,。；;.!?！？\r\n）)\]”"']|并|且|同时|然后|但|而|再|可|应|所以|因为|这|不代表|仅|and\b|but\b|while\b)/i.test(next);
}
/** Bounded literal candidates only: never predicts scores, rewrites values, or chooses a binding. */
export function createVerificationCandidates(input:{answer:string;question:string;rubric:unknown}){
 const rubric=RubricSchema.parse(input.rubric),answer=input.answer;
 if(typeof answer!=='string'||answer.length>10000||typeof input.question!=='string'||input.question.length>4000)throw new AgentStateError('VALIDATION_ERROR');
 const scope=hash(JSON.stringify([answer,input.question,rubric])),records=new Map<string,{criterionId:string;part:Part;span:Span}>();
 const catalog:VerificationCandidateCatalog=[];let total=0;
 for(const criterion of rubric.criteria){const goal=criterion.verificationGoal;if(!goal)continue;
  const metrics=literals(answer,goal.observationAliases),policy=goal.observationPolicy;
  const values=policy?unique([...metrics.flatMap(m=>{const tail=answer.slice(m.end),gap=tail.match(/^[ \t=:：为是]*/)?.[0].length??0,match=tail.slice(gap).match(policy.kind==='count'?count:duration);return match&&supportedValueEnd(tail.slice(gap+match[0].length))?[{start:m.end+gap,end:m.end+gap+match[0].length}]:[];}),...literals(answer,policy.predicateAliases??[])]):[];
  const candidates:Record<Part,Span[]>={action:literals(answer,goal.actionAliases),target:literals(answer,goal.targetAliases),expectation:unique(metrics.map(m=>enclosing(answer,m.start,m.end,clause))),metric:metrics,value:values,condition:policy?literals(answer,policy.conditionAliases):[]};
  const entries=(part:Part)=>{const spans=candidates[part];if(spans.length>16||(total+=spans.length)>128||spans.some(s=>s.end-s.start>500))throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
   return spans.map(span=>{const id='vc-'+hash(JSON.stringify([scope,criterion.id,part,span])).slice(0,24);records.set(id,{criterionId:criterion.id,part,span:{...span}});
    return{id,excerpt:answer.slice(span.start,span.end),context:{before:answer.slice(Math.max(0,span.start-24),span.start),after:answer.slice(span.end,span.end+24)}};});};
  catalog.push({criterionId:criterion.id,action:entries('action'),target:entries('target'),expectation:entries('expectation'),...(policy?{metric:entries('metric'),value:entries('value'),condition:entries('condition')}:{})});
 }
 const publicCatalog=VerificationCandidateCatalogSchema.parse(catalog);
 return Object.freeze({answer,catalog:structuredClone(publicCatalog),
  goalFor:(criterionId:string)=>{const goal=rubric.criteria.find(c=>c.id===criterionId)?.verificationGoal;return goal?structuredClone(goal):undefined;},
  resolve:(criterionId:string,part:Part,id:string)=>{const r=records.get(id);return r&&r.criterionId===criterionId&&r.part===part?{...r.span}:undefined;},
  evidenceFor:(spans:Span[])=>enclosing(answer,Math.min(...spans.map(s=>s.start)),Math.max(...spans.map(s=>s.end)),boundary),
 });
}
export type VerificationCandidates=ReturnType<typeof createVerificationCandidates>;
