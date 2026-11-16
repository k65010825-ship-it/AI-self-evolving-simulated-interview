import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {contentHash,canonical} from '../answers/validation.ts';
import {compileVerificationProposal,loadVerificationProposal,ProposalSchema,AliasCaseSchema,KnowledgeItemSchema,type CompiledProposal} from './proposal.ts';
import {runAliasCalibration} from './calibration.ts';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const SpecSchema=z.object({id:z.literal('verification-alias-revision-1'),origin:z.literal('assistant-authored-draft'),scope:z.literal('literal-alias-additions-only'),
 baselineArtifactDigest:digest,candidateArtifactDigest:digest,frozenCasesDigest:digest,supplementalCasesDigest:digest,
 labelCaveats:z.array(z.object({caseId:z.string().min(1),reason:z.string().min(1).max(1000)}).strict()).min(1).max(10)}).strict();
function invalid():never{throw Error('ALIAS_REVISION_INVALID');}
function artifact(p:CompiledProposal){const {now,...workspace}=p.workspace;return {manifest:p.manifest,workspace,cases:p.cases};}
/** Only literal alias additions and corresponding draft versions are allowed in this comparison. */
export function validateAliasRevisionScope(before:CompiledProposal,after:CompiledProposal){
 if(canonical(before.workspace.sources)!==canonical(after.workspace.sources)||canonical(before.manifest.sourceChecks)!==canonical(after.manifest.sourceChecks))invalid();
 const rows:{itemId:string;roleId:string;goalId:string;group:string;added:string[]}[]=[];
 for(const old of before.workspace.items){
  const candidate=after.workspace.items.find(i=>i.id===old.id);if(!candidate||candidate.version===old.version)invalid();const normalized=structuredClone(candidate);normalized.version=old.version;
  for(const c of normalized.rubric){const oldCriterion=old.rubric.find(r=>r.criterionId===c.criterionId);if(!oldCriterion)invalid();
   if(!oldCriterion.verificationGoal)continue;
   const goal=c.verificationGoal,base=oldCriterion.verificationGoal;if(!goal||goal.id!==base.id||goal.version===base.version)invalid();
   for(const group of ['actionAliases','targetAliases','observationAliases'] as const){
    if(goal[group].length<base[group].length||canonical(goal[group].slice(0,base[group].length))!==canonical(base[group]))invalid();
    const added=goal[group].slice(base[group].length);if(added.length)rows.push({itemId:old.id,roleId:old.roleId,goalId:base.id,group,added});
    goal[group]=[...base[group]];
   }
   goal.version=base.version;
  }
  if(canonical(normalized)!==canonical(old)||!rows.some(r=>r.itemId===old.id))invalid();
  const oldDossier=before.workspace.dossiers.find(d=>d.itemId===old.id)!,newDossier=after.workspace.dossiers.find(d=>d.itemId===old.id);if(!newDossier||oldDossier.version===newDossier.version)invalid();
  if(canonical({...newDossier,itemVersion:oldDossier.itemVersion,version:oldDossier.version})!==canonical(oldDossier))invalid();
 }
 return rows;
}
function assemble(rawSpec:unknown,before:CompiledProposal,after:CompiledProposal,rawSupplement:unknown){
 const parsed=SpecSchema.safeParse(rawSpec),supp=z.array(AliasCaseSchema).min(1).max(100).safeParse(rawSupplement);if(!parsed.success||!supp.success)invalid();
 const spec=parsed.data;
 if(before.workspace.now!==after.workspace.now)invalid();
 if(contentHash(artifact(before))!==spec.baselineArtifactDigest||contentHash(artifact(after))!==spec.candidateArtifactDigest||
  contentHash(before.cases)!==spec.frozenCasesDigest||canonical(before.cases)!==canonical(after.cases)||contentHash(supp.data)!==spec.supplementalCasesDigest)invalid();
 if(spec.labelCaveats.some(c=>!before.cases.some(x=>x.id===c.caseId)))invalid();
 const revisions=validateAliasRevisionScope(before,after),cases=[...before.cases,...supp.data];
 const extend=(p:CompiledProposal)=>compileVerificationProposal({manifest:p.manifest,workspace:p.workspace,cases},p.baseItems);
 const baselineCalibration=runAliasCalibration(extend(before)),candidateCalibration=runAliasCalibration(extend(after));
 if(baselineCalibration.datasetDigest!==candidateCalibration.datasetDigest||baselineCalibration.ruleDigest!==candidateCalibration.ruleDigest||baselineCalibration.runnerDigest!==candidateCalibration.runnerDigest)invalid();
 const rows=baselineCalibration.rows.map(b=>{
  const a=candidateCalibration.rows.find(x=>x.id===b.id)!;
  return {caseId:b.id,roleId:b.roleId,source:before.cases.some(c=>c.id===b.id)?'frozen' as const:'supplemental' as const,expectedBound:b.expectedBound,before:b.actualBound,after:a.actualBound,
   beforeReason:b.reason,afterReason:a.reason};
 });
 const originalRegressionIds=new Set(before.cases.filter(c=>c.lane==='regression').map(c=>c.id));
 const summary={frozenCases:before.cases.length,supplementalCases:supp.data.length,
  frozenRegressionsPreserved:rows.filter(r=>originalRegressionIds.has(r.caseId)).every(r=>r.before===r.after&&r.after===r.expectedBound),
  resolvedDraftFalseRejections:rows.filter(r=>r.expectedBound&&!r.before&&r.after).length,
  introducedDraftFalseAcceptances:rows.filter(r=>!r.expectedBound&&!r.before&&r.after).length,
  remainingDraftFalseAcceptances:rows.filter(r=>!r.expectedBound&&r.after).length,
  remainingDraftFalseRejections:rows.filter(r=>r.expectedBound&&!r.after).length};
 const body={version:1 as const,origin:'assistant-authored-development-comparison' as const,spec,
  comparisonRunnerDigest:createHash('sha256').update(readFileSync(new URL('./revision.ts',import.meta.url))).digest('hex'),
  baseline:{manifest:before.manifest,workspace:before.workspace,cases:before.cases},candidate:{manifest:after.manifest,workspace:after.workspace,cases:after.cases},
  baseItems:before.baseItems,supplementalCases:supp.data,labelCaveats:spec.labelCaveats,revisions,baselineCalibration,candidateCalibration,rows,summary,
  recommendation:summary.frozenRegressionsPreserved&&summary.introducedDraftFalseAcceptances===0?'eligible-for-review' as const:'changes-required' as const,
  productionPublished:false as const,humanReferenceCount:0 as const,qualityClaimEligible:false as const,liveModelCalls:0 as const};
 return {...body,digest:contentHash(body)};
}
export function createAliasRevisionComparison(){
 try{
  const before=compileVerificationProposal(loadVerificationProposal()),raw=loadVerificationProposal('alias-revision');raw.workspace.now=before.workspace.now;
  const after=compileVerificationProposal(raw),read=(name:string)=>JSON.parse(readFileSync(new URL('../../knowledge/proposals/verification-goals-v2/'+name,import.meta.url),'utf8'));
  return assemble(read('revision.json'),before,after,read('supplemental-cases.json'));
 }catch{invalid();}
}
const Input=z.object({version:z.literal(1),origin:z.literal('assistant-authored-development-comparison'),comparisonRunnerDigest:digest,spec:SpecSchema,baseline:ProposalSchema,candidate:ProposalSchema,baseItems:z.array(KnowledgeItemSchema).length(2),
 supplementalCases:z.array(AliasCaseSchema).min(1).max(100),labelCaveats:z.unknown(),revisions:z.unknown(),baselineCalibration:z.unknown(),candidateCalibration:z.unknown(),rows:z.unknown(),summary:z.unknown(),
 recommendation:z.enum(['eligible-for-review','changes-required']),productionPublished:z.literal(false),humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),liveModelCalls:z.literal(0),digest}).strict();
export function verifyAliasRevisionComparison(raw:unknown):ReturnType<typeof createAliasRevisionComparison>{
 try{
  if(Buffer.byteLength(JSON.stringify(raw))>4*1024*1024)invalid();const p=Input.safeParse(raw);if(!p.success)invalid();const {digest,...body}=p.data;
  if(contentHash(body)!==digest)invalid();
  const expected=assemble(p.data.spec,compileVerificationProposal(p.data.baseline,p.data.baseItems),compileVerificationProposal(p.data.candidate,p.data.baseItems),p.data.supplementalCases);
  if(canonical(expected)!==canonical(p.data))invalid();return expected;
 }catch{invalid();}
}
