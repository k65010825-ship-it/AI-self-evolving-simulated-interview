import javaSeed from '../../../../knowledge/java-backend/seed.json' with { type: 'json' };
import webSeed from '../../../../knowledge/web-frontend/seed.json' with { type: 'json' };
import javaExpansion from '../../../../knowledge/java-backend/expansion.json' with { type: 'json' };
import webExpansion from '../../../../knowledge/web-frontend/expansion.json' with { type: 'json' };
import sources from '../../../../knowledge/sources.json' with { type: 'json' };
import dossiers from '../../../../knowledge/dossiers.json' with { type: 'json' };
import reviews from '../../../../knowledge/reviews.json' with { type: 'json' };
import { KnowledgeWorkspaceSchema } from '../../../../packages/contracts/src/knowledge-curation.ts';
import { KnowledgeQuerySchema, ToolReceiptSchema, type ToolContext } from '../../../../packages/contracts/src/tools.ts';
import { buildKnowledgeCatalog } from './curation.ts';
import { createKnowledgeExecutor } from '../tools/knowledge-executor.ts';
import {KnowledgeCatalogPinSchema,type KnowledgeCatalogPin} from '../../../../packages/contracts/src/knowledge-catalog.ts';
import {HistoryCompatibilityPolicySchema} from '../../../../packages/contracts/src/history-compatibility.ts';
import {questionCatalogDigest,validCatalogPin} from '../../../../packages/interview-domain/src/question-eligibility.ts';
import {ROLE_CATALOG_VERSION,ROLE_SKILL_CATALOG,RoleListSchema,type RoleList} from '../../../../packages/contracts/src/role-catalog.ts';

export function loadKnowledgeWorkspace(now = Date.now()) {
  return KnowledgeWorkspaceSchema.parse({ items: [...javaSeed, ...javaExpansion, ...webSeed, ...webExpansion], sources, dossiers, reviews, now });
}
export function buildRoleCatalogList(now=Date.now()):RoleList{
 const workspace=loadKnowledgeWorkspace(now),catalog=buildKnowledgeCatalog(workspace,{mode:'draft-preview'});
 const byId=new Map(catalog.items.map(i=>[i.id,i]));
 return RoleListSchema.parse((['java-backend','web-frontend'] as const).map(roleId=>{
  const def=ROLE_SKILL_CATALOG[roleId];
  const mapSkill=(s:{skillId:string;label:string;category:'main'|'behavioral';relevance:number})=>{
   const matching=workspace.items.filter(i=>i.roleId===roleId&&i.skillId===s.skillId).map(i=>byId.get(i.id)!);
   const reviewedCount=matching.filter(i=>i.reviewStatus==='reviewed').length,draftCount=matching.length-reviewedCount;
   return{...s,draftCount,reviewedCount,availableInReviewedOnly:reviewedCount>0,availableInDraftPreview:matching.length>0};
  };
  return{id:def.id,label:def.label,catalogVersion:ROLE_CATALOG_VERSION,mainSkillCount:6 as const,
   skills:def.mainSkills.map(mapSkill),behavioralSkills:def.behavioralSkills.map(mapSkill)};
 }));
}
export function resolvePinnedCatalog(roleId:ToolContext['roleId'],mode:KnowledgeCatalogPin['mode']='seed',skillIds?:readonly string[],now=Date.now()):KnowledgeCatalogPin{
 const items=(mode==='seed'?[...javaSeed,...webSeed]:buildKnowledgeCatalog(loadKnowledgeWorkspace(now),{mode}).items)
  .filter(q=>q.roleId===roleId&&(!skillIds||skillIds.includes(q.skillId))).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const parsed=KnowledgeCatalogPinSchema.parse({schemaVersion:1,id:'pending',roleId,mode,digest:'0'.repeat(64),items});
 const digest=questionCatalogDigest(parsed);return{...parsed,id:`catalog-${mode}-${digest.slice(0,20)}`,digest};
}
export function catalogHistoryCompatibility(pin:KnowledgeCatalogPin){
 if(!validCatalogPin(pin))throw Error('VALIDATION_ERROR');
 return HistoryCompatibilityPolicySchema.parse({id:pin.id,mode:'strict',allowed:pin.items.map(q=>({skillId:q.skillId,rubricId:q.id,rubricVersion:q.version}))});
}
/** Host-only selection; model parameters cannot opt into drafts or replace this catalog. */
export function createCuratedKnowledgeExecutor(context: ToolContext, options: { mode?: 'reviewed-only' | 'draft-preview'; maxCalls?: number;
 excludeQuestionIds?:readonly string[];targetDifficulty?:number } = {}) {
  const workspace = loadKnowledgeWorkspace(), catalog = buildKnowledgeCatalog(workspace, options.mode === undefined ? {} : { mode: options.mode });
  const execute = createKnowledgeExecutor(context, { catalog: catalog.items, includeDrafts: catalog.mode === 'draft-preview',
    ...(options.maxCalls === undefined ? {} : { maxCalls: options.maxCalls }),
    ...(options.excludeQuestionIds===undefined?{}:{excludeQuestionIds:options.excludeQuestionIds}),
    ...(options.targetDifficulty===undefined?{}:{targetDifficulty:options.targetDifficulty}) });
  const guides = new Map(workspace.dossiers.map(d => [d.itemId, d]));
  return async (callId: string, raw: unknown, signal?: AbortSignal) => {
    const receipt = await execute(callId, raw, signal);
    if (receipt.status === 'error' || !receipt.data) return receipt;
    const query = KnowledgeQuerySchema.parse(raw);
    return ToolReceiptSchema.parse({ ...receipt, data: { ...receipt.data, guidance: receipt.data.items.map(item => {
      const d = guides.get(item.id)!;
      return { itemId: item.id, version: d.version, applicability: d.applicability, followups: d.followups, sourceReferences: d.sourceReferences,
        ...(query.purpose === 'scoring' ? { answerGuide: d.answerGuide } : {}) };
    }) } });
  };
}
