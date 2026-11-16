import type {VerificationGoal,VerificationBinding,BindingInvalidDetail,BindingSpanConflict} from '../../contracts/src/verification-binding.ts';
import {describeSpanConflict} from './span-conflict.ts';
export type ObservationResult=
 |{status:'bound';semanticSupport:'not_verified'}
 |{status:'invalid';reason:'verification-binding-invalid';detail:BindingInvalidDetail;conflict?:BindingSpanConflict}
 |{status:'insufficient';reason:'verification-observation-detail-missing'|'verification-observation-value-invalid'|'verification-observation-context-mismatch'};
const fold=(s:string)=>s.normalize('NFKC').toLowerCase().trim();
const same=(s:string,aliases:readonly string[])=>aliases.some(a=>fold(s)===fold(a));
const number='[-+]?(?:\\d+(?:\\.\\d+)?|[零一二三四五六七八九十百千万两]+)';
const count=new RegExp('^(?:(?:最多|至少|不超过|不低于|不超|不小于|少于|多于|等于|为|是|<=|>=|==|=|<|>|≤|≥|at most|at least|less than|more than|no more than|equal to)\\s*)?'+number+'(?:\\s*(?:个|次|条))?$','i');
const duration=new RegExp('^(?:'+number+'\\s*(?:ms|毫秒|s|秒|us|μs|微秒)|(?:减少|下降|降低|增加|上升|升高|不变|变快|变慢)(?:\\s*\\d+(?:\\.\\d+)?\\s*%)?|(?:decrease|increase|unchanged)(?:\\s*\\d+(?:\\.\\d+)?\\s*%)?)$','i');
/** Limited local value/condition syntax, not general measurement semantics or proof of execution. */
export function inspectObservationValue(goal:VerificationGoal,binding:VerificationBinding,unit:{id:string;start:number;end:number},answer:string):ObservationResult{
 const policy=goal.observationPolicy,observation=binding.observation;
 if(!policy)return observation?{status:'invalid',reason:'verification-binding-invalid',detail:'unexpected-observation'}:{status:'bound',semanticSupport:'not_verified'};
 if(!observation)return {status:'insufficient',reason:'verification-observation-detail-missing'};
 const refs=[observation.metric,observation.value,observation.condition],invalid=(detail:BindingInvalidDetail):Extract<ObservationResult,{status:'invalid'}>=>({status:'invalid',reason:'verification-binding-invalid',detail});
 if(refs.some(p=>p.evidenceId!==unit.id))return invalid('observation-span-unit-mismatch');
 if(refs.some(p=>!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||p.start<unit.start||p.end>unit.end||p.end<=p.start||p.end-p.start>500))return invalid('observation-span-range-invalid');
 const {metric,value,condition}=observation;
 if([metric,value].some(p=>p.start<binding.expectation.start||p.end>binding.expectation.end))return invalid('observation-outside-expectation');
 const text=(r:typeof metric)=>answer.slice(r.start,r.end),valueText=fold(text(value));
 if(!same(text(metric),goal.observationAliases))return {status:'insufficient',reason:'verification-observation-value-invalid'};
 const predicate=same(valueText,policy.predicateAliases??[]),overlap=metric.start<value.end&&value.start<metric.end;
 // A named predicate may include the metric (e.g. 没有超额); arbitrary overlapping fragments are forbidden.
 if(overlap&&!predicate)return {...invalid('observation-span-overlap'),conflict:describeSpanConflict(['metric','value'],metric,value)};
 if(!predicate&&!(policy.kind==='count'?count:duration).test(valueText))return {status:'insufficient',reason:'verification-observation-value-invalid'};
 const left=metric.end<=value.start?metric.end:value.end<=metric.start?value.end:0;
 const right=metric.end<=value.start?value.start:value.end<=metric.start?metric.start:0;
 const between=left===right?'':answer.slice(left,right);
 if(right-left>40||/[。；;!?！？\r\n]/.test(between)||/(?:字号|字体|颜色|背景|图标|\b(?:font|colou?r|background)\b)/i.test(between))
  return {status:'insufficient',reason:'verification-observation-context-mismatch'};
 const negative=/(?:没有|并未|不是|并非|\bdid not|\bnever)\s*$/i;
 if(negative.test(answer.slice(Math.max(unit.start,value.start-10),value.start))||
  !policy.conditionAliases.some(a=>fold(text(condition)).includes(fold(a)))||negative.test(answer.slice(Math.max(unit.start,condition.start-10),condition.start)))
  return {status:'insufficient',reason:'verification-observation-context-mismatch'};
 // Conservative attribution window, including the entire proposed condition excerpt.
 // A sentence/branch transition cannot be hidden by broadening that excerpt.
 const scopeParts=[condition,binding.action,binding.target,metric,value];
 const scopeStart=Math.min(...scopeParts.map(p=>p.start)),scopeEnd=Math.max(...scopeParts.map(p=>p.end));
 const scope=answer.slice(scopeStart,scopeEnd);
 if(scopeEnd-scopeStart>200||/[。；;!?！？\r\n]|(?<!\d)\.|\.(?!\d)/.test(scope)||
  /(?:否则|另在|另一(?:组|轮|分支)(?:条件|初值)|\b(?:else|otherwise)\b)/i.test(scope))
  return {status:'insufficient',reason:'verification-observation-context-mismatch'};
 return {status:'bound',semanticSupport:'not_verified'};
}
