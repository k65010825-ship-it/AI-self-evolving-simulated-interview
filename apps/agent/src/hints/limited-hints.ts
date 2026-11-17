import {HintBindingSchema,HintJournalSchema,type HintBinding,type HintJournal,type HintAssistance} from '../../../../packages/contracts/src/hints.ts';
export class HintError extends Error{constructor(readonly code:string){super(code);}}
const fail=(code:string):never=>{throw new HintError(code);};
function parse(raw:unknown):HintJournal{const p=HintJournalSchema.safeParse(raw);return p.success?p.data:fail('HINT_DATA_INVALID');}
function check(s:HintJournal,at:number){if(!Number.isSafeInteger(at)||at<(s.entries.at(-1)?.updatedAt??s.binding.issuedAt))fail('HINT_DATA_INVALID');}
export function createHintJournal(raw:unknown):HintJournal{return parse({schemaVersion:1,binding:HintBindingSchema.parse(raw),limit:2,version:0,entries:[]});}
export function restoreHintJournal(json:string,binding:HintBinding):HintJournal{
 if(typeof json!=='string'||json.length>300000)fail('HINT_DATA_INVALID');let value:unknown;try{value=JSON.parse(json);}catch{fail('HINT_DATA_INVALID');}
 const s=parse(value);if(JSON.stringify(s.binding)!==JSON.stringify(HintBindingSchema.parse(binding)))fail('HINT_BINDING_MISMATCH');return s;
}
export function reserveHint(raw:unknown,operationId:string,at:number):HintJournal{
 const s=parse(raw);check(s,at);const existing=s.entries.find(e=>e.operationId===operationId);
 if(existing){if(existing.status==='released')fail('HINT_OPERATION_RELEASED');return s;}
 if(s.entries.some(e=>e.status==='reserved'))fail('HINT_BUSY');
 const count=s.entries.filter(e=>e.status==='committed').length;if(count>=2)fail('HINT_LIMIT_REACHED');
 return parse({...s,version:s.version+1,entries:[...s.entries,{operationId,level:count+1,status:'reserved',reservedAt:at,updatedAt:at}]});
}
export function commitHint(raw:unknown,operationId:string,text:string,at:number):HintJournal{
 const s=parse(raw);check(s,at);const e=s.entries.find(e=>e.operationId===operationId);
 if(!e||e.status==='released')return fail('HINT_OPERATION_RELEASED');
 if(e.status==='committed'){if(e.text!==text)fail('HINT_OPERATION_CONFLICT');return s;}
 return parse({...s,version:s.version+1,entries:s.entries.map(e=>e.operationId===operationId?{...e,status:'committed',text,hintVersion:'coaching-v1',updatedAt:at}:e)});
}
export function releaseHint(raw:unknown,operationId:string,at:number):HintJournal{
 const s=parse(raw);check(s,at);const e=s.entries.find(e=>e.operationId===operationId);if(!e)return fail('HINT_OPERATION_RELEASED');
 if(e.status!=='reserved')return s;
 return parse({...s,version:s.version+1,entries:s.entries.map(e=>e.operationId===operationId?{...e,status:'released',updatedAt:at}:e)});
}
export function recoverHints(raw:unknown,at:number){const s=parse(raw),pending=s.entries.find(e=>e.status==='reserved');return pending?releaseHint(s,pending.operationId,at):s;}
export function hintAssistance(raw:unknown):HintAssistance|undefined{
 const s=parse(raw),receipts=s.entries.filter(e=>e.status==='committed');return receipts.length?{kind:'hint-assisted',issueId:s.binding.issueId,hintVersion:'coaching-v1',receiptIds:receipts.map(e=>e.operationId)}:undefined;
}
/** Fixed coaching prompts: no supplied answer, reference solution, URL, provider or credential is loaded. */
const templates={
 technical:['先拆解题目中的概念和适用前提，用你自己的话说明它们之间的关系。','再检查一个边界条件或反例，解释方案的代价，以及如何验证你的判断。'],
 project:['先说明你负责的目标、约束和具体职责，再选择一个亲自参与的决策展开。','补充你比较过的方案、取舍理由，以及能支持结果的实际证据或限制。'],
 scenario:['先明确场景目标、输入规模与约束，必要时说明你需要澄清的假设。','沿一个失败场景推演，检查一致性、恢复方式和验证手段，再说明方案取舍。'],
 behavioral:['先交代具体情境与任务，区分团队背景和你本人采取的行动。','补充行动产生的可核实结果，以及遇到分歧时的沟通和下一次改进。'],
} as const;
export function renderHint(type:keyof typeof templates,level:number){if(!Object.hasOwn(templates,type)||(level!==1&&level!==2))return fail('HINT_DATA_INVALID');return templates[type][level-1]!;}
