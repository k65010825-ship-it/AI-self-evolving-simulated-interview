import {createHash} from 'node:crypto';
import {z} from 'zod';
import {TurnInputSchema,TurnProposalSchema} from '../../contracts/src/evaluation.ts';
import {FeedbackRevisionCommandSchema,FeedbackRevisionRecordSchema,FeedbackRevisionHistorySchema,type FeedbackRevisionHistory} from '../../contracts/src/feedback-revision.ts';
import {RoleIdSchema} from '../../contracts/src/tools.ts';
import {projectFeedbackPublication} from './feedback-publication.ts';

const policyVersion='feedback-revision-v1' as const;
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`;
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const HostSchema=z.object({userId:z.string().min(1).max(100),roleId:RoleIdSchema,sessionId:z.string().min(1).max(100),editorId:z.string().min(1).max(100),
 authorizedEditorIds:z.array(z.string().min(1).max(100)).max(100),now:z.number().int().nonnegative()}).strict();
export type FeedbackRevisionHost=z.infer<typeof HostSchema>;
function fail():never{throw Error('FEEDBACK_REVISION_INVALID');}
function seal(body:Omit<FeedbackRevisionHistory,'digest'>){return FeedbackRevisionHistorySchema.parse({...body,digest:hash(body)});}
export function createFeedbackRevisionHistory(rawInput:unknown,rawProposal:unknown):FeedbackRevisionHistory{
 const input=TurnInputSchema.parse(rawInput),proposal=TurnProposalSchema.parse(rawProposal),p=projectFeedbackPublication(input,proposal);
 return seal({kind:'uncommitted-feedback-revision-history',version:1,policyVersion,userId:input.context.userId,roleId:input.context.roleId,sessionId:input.state.sessionId,
  originSourceDigest:p.publication.sourceDigest,headSourceDigest:p.publication.sourceDigest,records:[],qualityClaimEligible:false,identityVerified:false});
}
/** Private candidate replay. Source hashes prove consistency, not authenticated authorship. */
export function replayFeedbackRevisions(rawInput:unknown,rawProposal:unknown,rawHistory:unknown,rawHost:unknown){
 const input=TurnInputSchema.parse(rawInput),original=TurnProposalSchema.parse(rawProposal),history=FeedbackRevisionHistorySchema.parse(rawHistory),host=HostSchema.parse(rawHost);
 const base=createFeedbackRevisionHistory(input,original),{digest,...body}=history;
 if(hash(body)!==digest||history.originSourceDigest!==base.originSourceDigest||history.userId!==base.userId||history.roleId!==base.roleId||history.sessionId!==base.sessionId||
  host.userId!==base.userId||host.roleId!==base.roleId||host.sessionId!==base.sessionId)fail();
 let currentProposal=structuredClone(original),projection=projectFeedbackPublication(input,original),head=base.originSourceDigest;
 let revisionContext:{revisionDigest:string}|undefined;
 const versions=[{version:0,sourceDigest:head,feedback:structuredClone(original.feedback),projection}];
 const seen=new Set<string>();let lastAt=original.nextState.observations.at(-1)?.observedAt??0;
 for(const [index,r] of history.records.entries()){
  const {digest:recordDigest,sourceDigest,publicationDigest,revisionDigest,...identity}=r;
  if(hash({...identity,sourceDigest,publicationDigest,revisionDigest})!==recordDigest||hash(identity)!==revisionDigest||r.version!==index+1||
   r.originSourceDigest!==base.originSourceDigest||r.parentSourceDigest!==head||seen.has(r.requestId)||!host.authorizedEditorIds.includes(r.editorId)||
   r.createdAt<lastAt||r.createdAt>host.now||canonical(currentProposal.feedback)===canonical(r.feedback))fail();
  seen.add(r.requestId);lastAt=r.createdAt;
  currentProposal=TurnProposalSchema.parse({...original,feedback:r.feedback});revisionContext={revisionDigest};
  projection=projectFeedbackPublication(input,currentProposal,[],undefined,revisionContext);
  if(projection.publication.sourceDigest!==sourceDigest||hash(projection)!==publicationDigest)fail();head=sourceDigest;
  versions.push({version:r.version,sourceDigest:head,feedback:structuredClone(r.feedback),projection});
 }
 if(history.headSourceDigest!==head)fail();
 return {kind:'uncommitted-feedback-revision-replay' as const,currentProposal,projection,...(revisionContext?{revisionContext}:{}),versions,qualityClaimEligible:false as const,identityVerified:false as const,liveModelCalls:0 as const};
}
export function proposeFeedbackRevision(rawInput:unknown,rawProposal:unknown,rawHistory:unknown,rawCommand:unknown,rawHost:unknown){
 const history=FeedbackRevisionHistorySchema.parse(rawHistory),command=FeedbackRevisionCommandSchema.parse(rawCommand),host=HostSchema.parse(rawHost);
 const replay=replayFeedbackRevisions(rawInput,rawProposal,history,host);
 if(!host.authorizedEditorIds.includes(host.editorId))fail();
 const existing=history.records.find(r=>r.requestId===command.requestId);
 if(existing){
  if(existing.editorId!==host.editorId||existing.version!==command.expectedVersion+1||existing.parentSourceDigest!==command.expectedHeadDigest||
   canonical(existing.feedback)!==canonical(command.feedback)||existing.note!==command.note)fail();
  return {history,replay,record:structuredClone(existing)};
 }
 if(history.records.length>=20||command.expectedVersion!==history.records.length||command.expectedHeadDigest!==history.headSourceDigest||
  canonical(replay.currentProposal.feedback)===canonical(command.feedback))fail();
 const identity={kind:'uncommitted-feedback-revision' as const,policyVersion,authority:'host-declared-unverified' as const,version:history.records.length+1,
  requestId:command.requestId,originSourceDigest:history.originSourceDigest,parentSourceDigest:history.headSourceDigest,feedback:command.feedback,editorId:host.editorId,createdAt:host.now,note:command.note};
 const revisionDigest=hash(identity),original=TurnProposalSchema.parse(rawProposal),candidate=TurnProposalSchema.parse({...original,feedback:command.feedback});
 const projection=projectFeedbackPublication(rawInput,candidate,[],undefined,{revisionDigest});
 const recordBody={...identity,revisionDigest,sourceDigest:projection.publication.sourceDigest,publicationDigest:hash(projection)};
 const record=FeedbackRevisionRecordSchema.parse({...recordBody,digest:hash(recordBody)});
 const {digest:oldDigest,...old}=history;void oldDigest;
 const updated=seal({...old,headSourceDigest:record.sourceDigest,records:[...history.records,record]});
 return {history:updated,record,replay:replayFeedbackRevisions(rawInput,rawProposal,updated,host)};
}
