import {z} from 'zod';
import {ToolReceiptSchema,RoleIdSchema,type ToolReceipt,type KnowledgeItem} from '../../../../packages/contracts/src/tools.ts';
import {PlannerResultSchema} from '../../../../packages/contracts/src/knowledge-planner.ts';
import {EvaluationOutputSchema} from '../../../../packages/contracts/src/evaluation.ts';
import {BridgeModelOutputSchema} from '../../../../packages/contracts/src/question-delivery.ts';
import {AgentStateError} from '../planning/interview-state.ts';
import type {HarnessPhase} from './profiles.ts';
import type {HarnessHook} from './completion-gate.ts';
const planningScope=z.object({roleId:RoleIdSchema,skillId:z.string().min(1).max(100),allowDraftKnowledge:z.boolean()}).strict();
const deliveryScope=z.object({previousAnswerText:z.string().min(1).max(10000)}).strict();
function deny():never{throw new AgentStateError('MODEL_OUTPUT_INVALID');}
/** Required business contracts; extra host hooks can tighten these, never replace them. */
export function createStageHooks(phase:HarnessPhase,rawScope?:unknown):HarnessHook[]{
 if(phase==='evaluation')return [{id:'business-evaluation',stop:value=>{if(!EvaluationOutputSchema.safeParse(value).success)deny();}}];
 if(phase==='delivery'){
  const parsed=deliveryScope.safeParse(rawScope);if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
  const answer=parsed.data.previousAnswerText;
  return [{id:'business-delivery',stop:value=>{
   const out=BridgeModelOutputSchema.safeParse(value);if(!out.success)deny();
   const {bridge,excerpt}=out.data,first=answer.indexOf(excerpt);
   if(!bridge.includes(excerpt)||first<0||answer.indexOf(excerpt,first+1)!==-1)deny();
  }}];
 }
 if(phase!=='planning')throw new AgentStateError('VALIDATION_ERROR');
 const parsed=planningScope.safeParse(rawScope);if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
 const scope=parsed.data,receipts=new Map<string,ToolReceipt>(),items=new Map<string,KnowledgeItem>();
 return [{id:'business-planning',postToolUse:value=>{
  const parsed=ToolReceiptSchema.safeParse(value);if(!parsed.success||parsed.data.status==='error')deny();
  const receipt=parsed.data;
  if(receipts.has(receipt.callId))deny();
  for(const item of receipt.data!.items){
   if(item.roleId!==scope.roleId||item.skillId!==scope.skillId||item.reviewStatus==='draft'&&!scope.allowDraftKnowledge||item.sourceIds.some(id=>!receipt.sourceIds.includes(id)))deny();
   const prior=items.get(item.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(item))deny();
  }
  receipts.set(receipt.callId,receipt);for(const item of receipt.data!.items)items.set(item.id,item);
 },stop:value=>{
  const parsed=PlannerResultSchema.safeParse(value);if(!parsed.success)deny();const out=parsed.data;
  if(out.receipts.length!==receipts.size||new Set(out.receipts.map(r=>r.callId)).size!==receipts.size||
   out.receipts.some(r=>JSON.stringify(r)!==JSON.stringify(receipts.get(r.callId))))deny();
  const selected=out.selection;
  // This factory is entered only after the host decided that knowledge access is needed.
  if(!receipts.size||selected.status==='finished')deny();
  if(selected.status==='selected'){
   const item=items.get(selected.question.id);if(!item)deny();
   if(selected.question.roleId!==scope.roleId||selected.question.skillId!==scope.skillId||selected.question.text!==item.question||
    selected.question.questionType!==item.questionType||selected.question.difficulty!==item.difficulty||
    selected.source.knowledgeId!==item.id||selected.source.version!==item.version||selected.source.reviewStatus!==item.reviewStatus||
    JSON.stringify(selected.source.sourceIds)!==JSON.stringify(item.sourceIds)||selected.rubric.id!==item.id||selected.rubric.version!==item.version||selected.rubric.roleId!==scope.roleId)deny();
  }
 }}];
}
