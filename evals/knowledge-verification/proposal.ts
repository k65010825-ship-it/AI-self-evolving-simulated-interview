import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {KnowledgeWorkspaceSchema} from '../../packages/contracts/src/knowledge-curation.ts';
import {RoleIdSchema,KnowledgeItemSchema,type KnowledgeItem} from '../../packages/contracts/src/tools.ts';
import {loadKnowledgeWorkspace} from '../../apps/agent/src/knowledge/catalog.ts';
import {buildKnowledgeCatalog} from '../../apps/agent/src/knowledge/curation.ts';
import {contentHash} from '../answers/validation.ts';
const id=z.string().min(1).max(100),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const ManifestSchema=z.object({id,version:z.literal(1),authoredAt:z.iso.date(),origin:z.literal('assistant-authored-draft'),
 baseItems:z.array(z.object({id,version:id,digest}).strict()).length(2),
 sourceChecks:z.array(z.object({sourceId:id,sourceVersion:id,url:z.url(),section:z.string().min(1).max(1000),characters:z.number().int().min(500),capturedAt:z.iso.date(),
  extractor:z.literal('MarkItDown MCP'),nonEmpty:z.literal(true),structureUsable:z.literal(true),convertedTextDigest:digest}).strict()).length(2),
 reviewStatus:z.literal('draft'),productionPublished:z.literal(false)}).strict();
export const AliasCaseSchema=z.object({id,itemId:id,roleId:RoleIdSchema,lane:z.enum(['regression','known-risk']),expectedBound:z.boolean(),
 labelOrigin:z.literal('assistant-authored-synthetic-development'),text:z.string().min(1).max(10000),action:z.string().min(1).max(500),target:z.string().min(1).max(500),expectation:z.string().min(1).max(500),
 mode:z.enum(['proposed','reported']),note:z.string().min(1).max(1000),
 observation:z.object({metric:z.string().min(1).max(500),value:z.string().min(1).max(500),condition:z.string().min(1).max(500)}).strict().optional()}).strict();
export const ProposalSchema=z.object({manifest:ManifestSchema,workspace:KnowledgeWorkspaceSchema,cases:z.array(AliasCaseSchema).min(1).max(400)}).strict();
export function invalid():never{throw Error('VERIFICATION_REVIEW_INVALID');}
export type ProposalVariant='baseline'|'alias-revision'|'observation';
export function loadVerificationProposal(variant:ProposalVariant='baseline'){
 const folder=variant==='baseline'?'verification-goals-v1':variant==='alias-revision'?'verification-goals-v2':variant==='observation'?'verification-goals-v3':invalid();
 const read=(name:string)=>JSON.parse(readFileSync(new URL('../../knowledge/proposals/'+folder+'/'+name,import.meta.url),'utf8'));
 const manifest=ManifestSchema.parse(read('manifest.json'));
 return {manifest,workspace:{...read('workspace.json'),now:Math.max(Date.now(),Date.parse(manifest.authoredAt))},cases:read('alias-cases.json')};
}
export function compileVerificationProposal(raw:unknown,embeddedBase?:KnowledgeItem[]){
 const parsed=ProposalSchema.safeParse(raw);if(!parsed.success)invalid();const p=parsed.data;
 const current=embeddedBase??loadKnowledgeWorkspace(p.workspace.now).items;
 const baseItems=p.manifest.baseItems.map(ref=>{
  const item=current.find(i=>i.id===ref.id);if(!item||item.version!==ref.version||contentHash(item)!==ref.digest)invalid();return item;
 });
 if(new Set(baseItems.map(i=>i.id)).size!==2||p.workspace.items.length!==2||p.workspace.reviews.length||
  new Set(p.workspace.items.map(i=>i.roleId)).size!==2||p.workspace.items.some(i=>{
   const base=baseItems.find(b=>b.id===i.id);return !base||i.version===base.version||i.roleId!==base.roleId||i.reviewStatus!=='draft'||i.rubric.filter(c=>c.verificationGoal).length!==1;
  }))invalid();
 for(const check of p.manifest.sourceChecks){const source=p.workspace.sources.find(s=>s.id===check.sourceId);
  if(!source||source.version!==check.sourceVersion||source.url!==check.url||source.retrievedAt!==check.capturedAt||source.verificationStatus!=='content-checked')invalid();}
 if(new Set(p.manifest.sourceChecks.map(s=>s.sourceId)).size!==2)invalid();
 if(new Set(p.cases.map(c=>c.id)).size!==p.cases.length)invalid();
 for(const c of p.cases){const item=p.workspace.items.find(i=>i.id===c.itemId);if(!item||item.roleId!==c.roleId)invalid();
  for(const fragment of Object.values(c.observation??{})){const at=c.text.indexOf(fragment);if(at<0||c.text.indexOf(fragment,at+1)>=0)invalid();}
  const spans=[c.action,c.target,c.expectation].map(fragment=>{const at=c.text.indexOf(fragment);if(at<0||c.text.indexOf(fragment,at+1)>=0)invalid();return {start:at,end:at+fragment.length};});
  if(spans.some((a,i)=>spans.some((b,j)=>i<j&&a.start<b.end&&b.start<a.end)))invalid();
 }
 for(const role of ['java-backend','web-frontend']){const cases=p.cases.filter(c=>c.roleId===role);
  if(!cases.some(c=>c.expectedBound&&c.lane==='regression')||!cases.some(c=>!c.expectedBound&&c.lane==='regression')||!cases.some(c=>c.lane==='known-risk'))invalid();}
 const catalog=buildKnowledgeCatalog(p.workspace,{mode:'draft-preview'});
 if(catalog.summary.reviewed!==0||catalog.summary.readyForHumanReview!==2)invalid();
 return {...p,baseItems,catalog};
}
export type CompiledProposal=ReturnType<typeof compileVerificationProposal>;
export {KnowledgeItemSchema};
