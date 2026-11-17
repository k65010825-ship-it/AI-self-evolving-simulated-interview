import {createHash} from 'node:crypto';import type {Database} from 'bun:sqlite';
import {HintRequestSchema,HintStatusInputSchema,HintReceiptSchema,type HintBinding,type HintJournal,type HintAssistance} from '../../../../packages/contracts/src/hints.ts';
import type {InterviewWorkflow} from '../../../../packages/contracts/src/session-workflow.ts';
import type {HintRepository} from '../hints/repository-port.ts';
import {createHintJournal,reserveHint,commitHint,releaseHint,recoverHints,restoreHintJournal,hintAssistance,renderHint} from '../hints/limited-hints.ts';
import {LocalError,type LocalProfile} from './profile-store.ts';
const fail=(code:string):never=>{throw new LocalError(code);};
type Session={workflow:InterviewWorkflow;deadlineAt:number};
function binding(w:InterviewWorkflow,q:InterviewWorkflow['issuedQuestions'][number]):HintBinding{
 if(!q.content)return fail('HINT_CONTENT_UNAVAILABLE');
 return{userId:w.identity.userId,roleId:w.identity.roleId,sessionId:w.state.sessionId,
  issueId:createHash('sha256').update(JSON.stringify([w.identity,w.state.sessionId,q])).digest('hex'),questionId:q.questionId,issuedAt:q.issuedAt};
}
export function createLocalHintHost(o:{profile:LocalProfile;repository?:HintRepository;now:()=>number;
 session:(db:Database,id:string)=>Session;commitAssistance:(db:Database,w:InterviewWorkflow,a:HintAssistance)=>void;assertAvailable:(db:Database,id:string,operationId:string)=>void}){
 const repo=o.repository;
 function load(db:Database,b:HintBinding){const s=repo!.load(db,b);return s?restoreHintJournal(JSON.stringify(s),b):null;}
 function save(db:Database,next:HintJournal,previous:HintJournal|null){repo!.save(db,next,previous?.version??null);}
 function verifyProvenance(w:InterviewWorkflow,b:HintBinding,s:HintJournal|null){
  const durable=w.hintAssistance?.find(h=>h.questionId===b.questionId)?.assistance;
  if(durable&&durable.issueId!==b.issueId||JSON.stringify(s?hintAssistance(s):undefined)!==JSON.stringify(durable))fail('HINT_BINDING_MISMATCH');
  return durable;
 }
 function current(w:InterviewWorkflow){const q=w.issuedQuestions.at(-1);return w.phase==='awaiting_answer'&&w.current&&q&&q.questionId===w.current.question.id?binding(w,q):null;}
 function receipt(s:HintJournal,operationId:string){const e=s.entries.find(e=>e.operationId===operationId);if(e?.status!=='committed')return fail('HINT_BUSY');
  return HintReceiptSchema.parse({operationId,sessionId:s.binding.sessionId,issueId:s.binding.issueId,questionId:s.binding.questionId,
   level:e.level,remaining:2-e.level,text:e.text,hintVersion:e.hintVersion,assisted:true});}
 // Startup recovers only local template reservations, never model calls or accounting unknown.
 if(repo)o.profile.write(db=>{const pending=repo.pending(db,o.profile.profileId);if(pending.length>4000)fail('HINT_DATA_INVALID');
  for(const raw of pending){if(raw.binding.userId!==o.profile.profileId)fail('HINT_BINDING_MISMATCH');
   const w=o.session(db,raw.binding.sessionId).workflow,q=w.issuedQuestions.find(q=>q.content&&binding(w,q).issueId===raw.binding.issueId);
   if(!q)fail('HINT_BINDING_MISMATCH');const s=restoreHintJournal(JSON.stringify(raw),binding(w,q!)),next=recoverHints(s,o.now());if(next.version!==s.version)save(db,next,s);}
 });
 return{
  available:!!repo,
  ownsOperation:(db:Database,id:string)=>!!repo?.findOperation(db,o.profile.profileId,id)||!!db.query("SELECT 1 FROM local_sessions s,json_each(s.workflow,'$.hintAssistance') h,json_each(h.value,'$.assistance.receiptIds') r WHERE r.value=? LIMIT 1").get(id),
  assistanceIn(db:Database,w:InterviewWorkflow){const b=current(w);if(!b)return undefined;
   const durable=w.hintAssistance?.find(h=>h.questionId===b.questionId)?.assistance;
   if(durable&&durable.issueId!==b.issueId)fail('HINT_BINDING_MISMATCH');
   if(!repo)return durable;
   const s=load(db,b);if(s?.entries.some(e=>e.status==='reserved'))fail('HINT_BUSY');return verifyProvenance(w,b,s);
  },
  status(raw:unknown){const p=HintStatusInputSchema.safeParse(raw);if(!p.success)return fail('VALIDATION_ERROR');
   return o.profile.read(db=>{const {workflow:w}=o.session(db,p.data.sessionId),b=current(w);
    if(!repo)return{available:false as const,reason:'HINT_STORAGE_UNAVAILABLE' as const,issueId:null,used:null,remaining:null};
    if(!b)return{available:false as const,reason:'NO_CURRENT_QUESTION' as const,issueId:null,used:null,remaining:null};
    const s=load(db,b);verifyProvenance(w,b,s);const used=s?.entries.filter(e=>e.status==='committed').length??0,reserved=s?.entries.some(e=>e.status==='reserved')??false;
    return{available:true as const,reason:null,issueId:b.issueId,used,remaining:2-used,reserved,hintVersion:'coaching-v1' as const};
   });
  },
  request(raw:unknown){const p=HintRequestSchema.safeParse(raw);if(!p.success)return fail('VALIDATION_ERROR');if(!repo)return fail('HINT_STORAGE_UNAVAILABLE');const c=p.data;
   const reservation=o.profile.write(db=>{const {workflow:w,deadlineAt}=o.session(db,c.sessionId),q=w.issuedQuestions.find(q=>q.content&&binding(w,q).issueId===c.issueId);
    if(!q)return fail('HINT_ISSUE_MISMATCH');const b=binding(w,q),s=load(db,b),known=repo.findOperation(db,o.profile.profileId,c.operationId);
    if(known&&known.issueId!==b.issueId)fail('HINT_OPERATION_CONFLICT');verifyProvenance(w,b,s);
    const prior=s?.entries.find(e=>e.operationId===c.operationId);if(prior?.status==='committed')return{receipt:receipt(s!,c.operationId)};
    // Replay precedes current revision/phase/budget checks; a committed receipt never regenerates.
    o.assertAvailable(db,c.sessionId,c.operationId);
    if(w.revision!==c.expectedRevision)fail('VERSION_CONFLICT');if(current(w)?.issueId!==b.issueId)fail('HINT_ISSUE_MISMATCH');
    if(o.now()>=deadlineAt)fail('DEADLINE_EXCEEDED');if(prior?.status==='reserved')fail('HINT_BUSY');
    const next=reserveHint(s??createHintJournal(b),c.operationId,o.now());save(db,next,s);
    return{journal:next,questionType:q.content!.question.questionType};
   });
   if('receipt'in reservation)return reservation.receipt;
   const {journal,questionType}=reservation;
   try{
    const text=renderHint(questionType,journal.entries.at(-1)!.level);
    return o.profile.write(db=>{const {workflow:w,deadlineAt}=o.session(db,c.sessionId);o.assertAvailable(db,c.sessionId,c.operationId);
     if(w.revision!==c.expectedRevision||current(w)?.issueId!==c.issueId)fail('VERSION_CONFLICT');if(o.now()>=deadlineAt)fail('DEADLINE_EXCEEDED');
     const s=load(db,journal.binding);if(!s||s.version!==journal.version) return fail('HINT_OPERATION_CONFLICT');
     const next=commitHint(s,c.operationId,text,o.now());save(db,next,s);o.commitAssistance(db,w,hintAssistance(next)!);return receipt(next,c.operationId);
    });
   }catch(error){try{o.profile.write(db=>{const s=load(db,journal.binding);if(s&&s.entries.find(e=>e.operationId===c.operationId)?.status==='reserved')save(db,releaseHint(s,c.operationId,o.now()),s);});}catch{/* Recovery must retain unknown local commit state; never touch model budget. */}throw error;}
  },
 };
}
