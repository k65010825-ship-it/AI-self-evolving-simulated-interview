import { SemanticReviewLedgerSchema,SemanticReviewOperationSchema,SemanticReviewHostSchema,
 type SemanticReviewLedger,type SemanticReviewOperation } from '../../../packages/contracts/src/semantic-review.ts';
import { canonical,contentHash } from '../validation.ts';
import { loadSemanticDataset,compileSemanticDataset } from './dataset.ts';
type Baseline=SemanticReviewLedger['baseline'][number];
type Active={claimId:string;requestDigest:string;labelVersion:number;labelDigest:string;reference:Baseline['reference'];authorId:string;labelAt:number;
 reviews:{actorId:string;decision:'approved'|'changes_requested'}[]};
export class SemanticReviewError extends Error{constructor(readonly code:string){super(code);}}
function fail(code='SEMANTIC_REVIEW_INVALID'):never{throw new SemanticReviewError(code);}
const current=()=>compileSemanticDataset(loadSemanticDataset());
function baselineFor(d:ReturnType<typeof current>){return d.samples.map(s=>({claimId:s.id,roleId:s.roleId,sourceCaseId:s.sourceCaseId,groupId:s.groupId,
 requestDigest:contentHash(s.request),reference:s.reference,referenceDigest:contentHash(s.reference),authorId:'assistant-proposed' as const}));}
function begin(l:SemanticReviewLedger){return new Map(l.baseline.map(b=>[b.claimId,{claimId:b.claimId,requestDigest:b.requestDigest,labelVersion:0,labelDigest:b.referenceDigest,
 reference:structuredClone(b.reference),authorId:b.authorId as string,labelAt:l.createdAt,reviews:[]} as Active]));}
function apply(states:Map<string,Active>,op:SemanticReviewOperation,actorId:string,acceptedAt:number,seq:number){
 const s=states.get(op.claimId);if(!s)fail();
 if(op.expectedLedgerVersion!==seq||op.expectedLabelVersion!==s.labelVersion)fail('SEMANTIC_REVIEW_CONFLICT');
 if(op.requestDigest!==s.requestDigest||op.labelDigest!==s.labelDigest)fail('SEMANTIC_REVIEW_STALE');
 if(op.occurredAt<s.labelAt||op.occurredAt>acceptedAt)fail();
 if(op.action.kind==='revise_label'){
  if(contentHash(op.action.reference)===s.labelDigest)fail('SEMANTIC_REVIEW_NO_CHANGE');
  s.labelVersion++;s.reference=structuredClone(op.action.reference);s.labelDigest=contentHash(s.reference);s.authorId=actorId;s.labelAt=op.occurredAt;s.reviews=[];
 }else{
  if(actorId===s.authorId)fail('SEMANTIC_REVIEW_SELF_REVIEW');
  if(s.reviews.some(r=>r.actorId===actorId))fail('SEMANTIC_REVIEW_CONFLICT');
  if(op.action.decision==='approved'&&!Object.values(op.action.checks).every(Boolean))fail('SEMANTIC_REVIEW_CHECKS_FAILED');
  s.reviews.push({actorId,decision:op.action.decision});
 }
}
function decode(raw:unknown){const p=SemanticReviewLedgerSchema.safeParse(raw);if(!p.success)fail();const l=p.data;
 const{digest,...body}=l;if(contentHash(body)!==digest||l.version!==l.records.length||l.createdAt>l.updatedAt||new Set(l.baseline.map(b=>b.claimId)).size!==l.baseline.length
  ||l.baseline.some(b=>b.referenceDigest!==contentHash(b.reference))||new Set(l.records.map(r=>r.operation.operationId)).size!==l.records.length)fail();
 const states=begin(l);let accepted=l.createdAt;
 for(const[i,r]of l.records.entries()){
  if(r.seq!==i+1||r.acceptedAt<accepted||r.acceptedAt>l.updatedAt)fail();apply(states,r.operation,r.actorId,r.acceptedAt,i);accepted=r.acceptedAt;
 }
 if(l.updatedAt!==accepted)fail();return{ledger:l,states};
}
function binding(l:SemanticReviewLedger){const d=current(),matches=l.datasetId===d.id&&l.datasetDigest===d.digest;
 if(matches&&canonical(l.baseline)!==canonical(baselineFor(d)))fail();return matches;}
function seal(body:Omit<SemanticReviewLedger,'digest'>){const ledger={...body,digest:contentHash(body)};return decode(ledger).ledger;}
export function createReviewLedger(now:number):SemanticReviewLedger{
 if(!Number.isSafeInteger(now)||now<0)fail();const d=current();
 return seal({schemaVersion:1,kind:'uncommitted-semantic-review-ledger',datasetId:d.id,datasetDigest:d.digest,authority:'file-declared-unverified',
  createdAt:now,updatedAt:now,version:0,baseline:baselineFor(d),records:[]});
}
export function inspectReviewLedger(raw:unknown){const{ledger:l,states}=decode(raw),currentBinding=binding(l);
 const claims=[...states.values()].map(s=>{
  const approved=s.reviews.some(r=>r.decision==='approved'),changes=s.reviews.some(r=>r.decision==='changes_requested');
  const status=!currentBinding?'stale_held' as const:approved&&changes?'disputed' as const:changes?'changes_requested' as const:approved?'declared_approved' as const:'unreviewed' as const;
  return{claimId:s.claimId,requestDigest:s.requestDigest,labelVersion:s.labelVersion,labelDigest:s.labelDigest,verdict:s.reference.verdict,authorId:s.authorId,reviewCount:s.reviews.length,status};
 });
 return{binding:currentBinding?'current' as const:'stale' as const,ledgerVersion:l.version,authority:'file-declared-unverified' as const,claims,
  declaredApprovedClaims:claims.filter(c=>c.status==='declared_approved').length,disputedClaims:claims.filter(c=>c.status==='disputed').length,
  humanReferenceCount:0 as const,qualityClaimEligible:false as const,baselineOverwritten:false as const};
}
export function recordSemanticReview(rawLedger:unknown,rawOperation:unknown,rawHost:unknown):SemanticReviewLedger{
 const{ledger:l,states}=decode(rawLedger),op=SemanticReviewOperationSchema.safeParse(rawOperation),host=SemanticReviewHostSchema.safeParse(rawHost);
 if(!op.success||!host.success)fail();if(!binding(l))fail('SEMANTIC_REVIEW_STALE');
 const existing=l.records.find(r=>r.operation.operationId===op.data.operationId);
 if(existing){if(host.data.now<existing.acceptedAt)fail();if(existing.actorId!==host.data.actorId||canonical(existing.operation)!==canonical(op.data))fail('SEMANTIC_REVIEW_CONFLICT');return l;}
 if(host.data.now<l.updatedAt||l.records.length>=2000)fail();apply(states,op.data,host.data.actorId,host.data.now,l.version);
 const{digest,...body}=l;
 return seal({...body,version:l.version+1,updatedAt:host.data.now,records:[...l.records,{seq:l.version+1,actorId:host.data.actorId,
  authority:'file-declared-unverified',acceptedAt:host.data.now,operation:op.data}]});
}
export function reviewOperationTemplate(ledger:SemanticReviewLedger){const view=inspectReviewLedger(ledger);
 return{instruction:'Fill operationId, occurredAt, decision/checks/note. null is deliberately invalid; actor identity is supplied by the host, not this JSON.',
  operations:view.claims.map(c=>({operationId:null,expectedLedgerVersion:ledger.version,claimId:c.claimId,expectedLabelVersion:c.labelVersion,requestDigest:c.requestDigest,
   labelDigest:c.labelDigest,occurredAt:null,action:{kind:'review_label',decision:null,checks:{literalMatch:null,criterionAlignment:null,scoreSupport:null},note:null}}))};
}
