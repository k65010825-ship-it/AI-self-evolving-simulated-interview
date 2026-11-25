import {createHash} from 'node:crypto';
import type {KnowledgeItem,RoleId,ToolReceipt} from '../../contracts/src/tools.ts';
import type {KnowledgeCatalogPin} from '../../contracts/src/knowledge-catalog.ts';

type Evidence={questionId:string;skillId:string;questionType:string};
export function eligibleQuestions<T extends KnowledgeItem>(items:readonly T[],input:{roleId:RoleId;skillIds:readonly string[];
 askedQuestionIds:readonly string[];priorEvidence:readonly Evidence[];observations:readonly Evidence[];allowDraftKnowledge:boolean;targetDifficulty:number}){
 const skills=new Set(input.skillIds),seen=new Set([...input.askedQuestionIds,...input.priorEvidence.map(o=>o.questionId),...input.observations.map(o=>o.questionId)]);
 const constructs=new Map([...input.priorEvidence,...input.observations].map(o=>[o.skillId,o.questionType==='behavioral']));
 return items.filter(q=>q.roleId===input.roleId&&skills.has(q.skillId)&&!seen.has(q.id)
  &&(q.reviewStatus==='reviewed'||input.allowDraftKnowledge)
  &&(!constructs.has(q.skillId)||constructs.get(q.skillId)===(q.questionType==='behavioral')))
  .sort((a,b)=>Math.abs(a.difficulty-input.targetDifficulty)-Math.abs(b.difficulty-input.targetDifficulty)||(a.id<b.id?-1:a.id>b.id?1:0));
}
const canonical=(value:unknown):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:
 `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
export function questionCatalogDigest(pin:Pick<KnowledgeCatalogPin,'roleId'|'mode'|'items'>){
 return createHash('sha256').update(canonical({roleId:pin.roleId,mode:pin.mode,items:pin.items})).digest('hex');
}
export function validCatalogPin(pin:KnowledgeCatalogPin){
 return pin.digest===questionCatalogDigest(pin)&&pin.id===`catalog-${pin.mode}-${pin.digest.slice(0,20)}`
  &&pin.items.every(q=>q.roleId===pin.roleId&&(pin.mode!=='reviewed-only'||q.reviewStatus==='reviewed'))
  &&new Set(pin.items.map(q=>q.id)).size===pin.items.length;
}
/** Validate every persisted retrieval, not just the selected item. Pinned planners expose no dossier payload. */
export function validPinnedReceipts(receipts:readonly ToolReceipt[],skillId:string|null,eligible:readonly KnowledgeItem[]){
 const calls=new Set<string>(),items=new Map(eligible.map(q=>[q.id,q]));
 for(const receipt of receipts){
  if(calls.has(receipt.callId)||receipt.status==='error'||!receipt.data||receipt.data.guidance?.length)return false;
  calls.add(receipt.callId);
  if(receipt.status!==(receipt.data.items.length?'ok':'empty'))return false;
  if(new Set(receipt.data.items.map(q=>q.id)).size!==receipt.data.items.length)return false;
  for(const q of receipt.data.items)if(q.skillId!==skillId||canonical(q)!==canonical(items.get(q.id)??null))return false;
  const sources=[...new Set(receipt.data.items.flatMap(q=>q.sourceIds))].sort();
  if(canonical([...receipt.sourceIds].sort())!==canonical(sources))return false;
 }
 return true;
}
