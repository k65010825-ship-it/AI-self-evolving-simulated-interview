import {z} from 'zod';
import {contentHash,canonical} from '../answers/validation.ts';
import {runAliasCalibration} from './calibration.ts';
import {compileVerificationProposal,loadVerificationProposal,ProposalSchema,KnowledgeItemSchema,invalid,type CompiledProposal,type ProposalVariant} from './proposal.ts';
function assemble(p:CompiledProposal){
 const entries=p.workspace.items.map(candidate=>{
  const base=p.baseItems.find(i=>i.id===candidate.id)!,entry=p.catalog.entries.find(e=>e.itemId===candidate.id)!;
  const before=base as unknown as Record<string,unknown>,after=candidate as unknown as Record<string,unknown>;
  const delta=[...new Set([...Object.keys(base),...Object.keys(candidate)])].sort().filter(key=>canonical(before[key])!==canonical(after[key])).map(field=>({field,before:before[field]??null,after:after[field]??null}));
  return {base,candidate,dossier:p.workspace.dossiers.find(d=>d.itemId===candidate.id)!,sources:p.workspace.sources.filter(s=>candidate.sourceIds.includes(s.id)),
   delta,contentDigest:entry.contentDigest,sourcesDigest:entry.sourcesDigest,reviewStatus:entry.reviewStatus,issues:entry.issues};
 });
 const reviewTemplate=entries.map(e=>({itemId:e.candidate.id,itemVersion:e.candidate.version,contentDigest:e.contentDigest,sourcesDigest:e.sourcesDigest,
  reviewerId:null,reviewedAt:null,decision:null,checks:{technicalAccuracy:null,scoringClarity:null,sourceAlignment:null,roleFit:null,aliasFalseAcceptance:null,aliasFalseRejection:null,
   ...(e.candidate.rubric.some(c=>c.verificationGoal?.observationPolicy)?{observationConditions:null,extractionCoverage:null}: {})}}));
 const body={version:1 as const,origin:'assistant-authored-draft' as const,authority:'file-declared-unverified' as const,productionPublished:false as const,
  proposal:{manifest:p.manifest,workspace:p.workspace,cases:p.cases},baseItems:p.baseItems,entries,calibration:runAliasCalibration(p),reviewTemplate,
  humanReferenceCount:0 as const,qualityClaimEligible:false as const};
 return {...body,digest:contentHash(body)};
}
export const createVerificationReviewPacket=(variant:ProposalVariant='baseline')=>assemble(compileVerificationProposal(loadVerificationProposal(variant)));
const PacketInput=z.object({version:z.literal(1),origin:z.literal('assistant-authored-draft'),authority:z.literal('file-declared-unverified'),productionPublished:z.literal(false),
 proposal:ProposalSchema,baseItems:z.array(KnowledgeItemSchema).length(2),entries:z.unknown(),calibration:z.unknown(),reviewTemplate:z.unknown(),
 humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function verifyVerificationReviewPacket(raw:unknown):ReturnType<typeof createVerificationReviewPacket>{
 try{
  if(Buffer.byteLength(JSON.stringify(raw))>4*1024*1024)invalid();
  const parsed=PacketInput.safeParse(raw);if(!parsed.success)invalid();
  const {digest,...body}=parsed.data;if(contentHash(body)!==digest)invalid();
  const expected=assemble(compileVerificationProposal(parsed.data.proposal,parsed.data.baseItems));
  if(canonical(expected)!==canonical(parsed.data))invalid();return expected;
 }catch{invalid();}
}
