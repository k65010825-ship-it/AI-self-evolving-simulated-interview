import {Database} from 'bun:sqlite';import {existsSync,lstatSync,mkdirSync} from 'node:fs';import{resolve,dirname}from'node:path';import{randomUUID}from'node:crypto';
import {FieldParticipantSchema,FieldSessionManifestSchema,FieldAnswerCommandSchema,type FieldParticipant} from '../../../../packages/contracts/src/field-session.ts';
import{RoleIdSchema,type RoleId}from'../../../../packages/contracts/src/tools.ts';
import{AgentRunRequestSchema,AgentRunSnapshotSchema,type AgentRunRequest}from'../../../../packages/contracts/src/agent-run.ts';
import {ScoringContextSchema} from '../../../../packages/contracts/src/scoring.ts';
import {createInterviewState} from '../planning/interview-state.ts';import{createScoringExecutor}from'../tools/scoring-executor.ts';
import{loadKnowledgeWorkspace}from'../knowledge/catalog.ts';
import{createReviewBundle,evaluateReviews,type ReviewBundle}from'../../../../evals/field-evidence/index.ts';import{contentHash}from'../../../../evals/answers/validation.ts';
const roles=['java-backend','web-frontend']as const,types=['technical','scenario','project','behavioral']as const;
function checkedFile(path:string){const file=resolve(path);if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('FIELD_SESSION_LINK');return file;}
export function createFieldSession(path:string,input:FieldParticipant){const p=FieldParticipantSchema.parse(input);if(p.consentedAt>Date.now()+1000)throw Error('FIELD_FUTURE_CONSENT');const file=checkedFile(path);if(existsSync(file))throw Error('FIELD_SESSION_EXISTS');mkdirSync(dirname(file),{recursive:true});
 const w=loadKnowledgeWorkspace(),items=roles.flatMap(r=>types.flatMap(t=>w.items.filter(i=>i.roleId===r&&i.questionType===t).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,2)));
 const manifest=FieldSessionManifestSchema.parse({...p,version:1,studyId:randomUUID(),createdAt:Date.now(),origin:'participant-declared-not-authenticated',knowledgeStatus:'draft',items,
 sourceReferences:Object.fromEntries(items.map(i=>[i.id,w.dossiers.find(d=>d.itemId===i.id)!.sourceReferences]))});
 const db=new Database(file,{create:true,strict:true});try{db.exec('CREATE TABLE manifest(body TEXT NOT NULL,digest TEXT NOT NULL);');db.query('INSERT INTO manifest VALUES(?,?)').run(JSON.stringify(manifest),contentHash(manifest));}finally{db.close();}return openFieldSession(file);
}
export function openFieldSession(path:string){const file=checkedFile(path);if(!existsSync(file))throw Error('FIELD_SESSION_MISSING');const db=new Database(file,{strict:true});
 let manifest:ReturnType<typeof FieldSessionManifestSchema.parse>;
 try{const row=db.query('SELECT body,digest FROM manifest').get()as{body:string;digest:string}|null;if(!row)throw Error('FIELD_MANIFEST_MISSING');manifest=FieldSessionManifestSchema.parse(JSON.parse(row.body));if(contentHash(manifest)!==row.digest)throw Error('FIELD_MANIFEST_CHANGED');
 for(const r of roles)for(const t of types)if(manifest.items.filter(i=>i.roleId===r&&i.questionType===t).length!==2)throw Error('FIELD_ROLE_COVERAGE');
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS answers(question_id TEXT PRIMARY KEY,role_id TEXT NOT NULL,text TEXT NOT NULL,normalized_hash TEXT NOT NULL,submitted_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS scores(question_id TEXT PRIMARY KEY,request TEXT NOT NULL,snapshot TEXT,mode TEXT NOT NULL DEFAULT 'unverified');
 CREATE TABLE IF NOT EXISTS packets(role_id TEXT PRIMARY KEY,digest TEXT NOT NULL,body TEXT NOT NULL);`);
 }catch(e){db.close();throw e;}
 type Answer={question_id:string;role_id:RoleId;text:string;submitted_at:number};
 const answer=(id:string)=>db.query('SELECT * FROM answers WHERE question_id=?').get(id)as Answer|null;
 const item=(id:string)=>{const k=manifest.items.find(i=>i.id===id);if(!k)throw Error('FIELD_QUESTION_UNKNOWN');return k;};
 const rubric=(id:string)=>{const k=item(id);return{id:k.id,version:k.version,roleId:k.roleId,scope:k.questionType==='behavioral'?'behavioral-content':'technical-content',criteria:k.rubric.map(({criterionId,...c})=>({id:criterionId,required:true,...c}))};};
 const scoreRow=(id:string)=>db.query('SELECT request,snapshot,mode FROM scores WHERE question_id=?').get(id)as {request:string;snapshot:string|null;mode:string}|null;
 function bundle(role:RoleId){RoleIdSchema.parse(role);const rows=manifest.items.filter(i=>i.roleId===role).flatMap(k=>{const a=answer(k.id);if(!a)return[];const row=scoreRow(k.id),snapshot=row?.snapshot?AgentRunSnapshotSchema.parse(JSON.parse(row.snapshot)):null;
 const result=snapshot?.status==='completed'&&snapshot.result?.kind==='uncommitted-turn-result'?snapshot.result.proposal:null;
 return[{id:k.id,version:k.version,roleId:role,kind:'answer' as const,authorId:manifest.participantId,sourceGroupId:manifest.studyId,sourceReferences:manifest.sourceReferences[k.id]!,modelScore:result?.evaluation.normalizedScore??null,
 payload:{question:{id:k.id,text:k.question,questionType:k.questionType,skillId:k.skillId,difficulty:k.difficulty},rubric:rubric(k.id),answer:{text:a.text},
  evidence:result?.evidence??[],claimedCriteria:result?.evaluation.dimensions.map(d=>({criterionId:d.criterionId,evidenceIds:d.evidenceIds}))??[],modelEvidenceMode:row?.mode??'not-evaluated',collectionMode:'participant-declared-not-authenticated',knowledgeStatus:'draft'}}];});
 const input={datasetId:`${manifest.studyId}-${role}`,minimumCases:8,developmentGroupIds:[],developmentReviewerIds:manifest.developmentReviewerIds,items:rows},digest=contentHash(input);
 const old=db.query('SELECT digest,body FROM packets WHERE role_id=?').get(role)as{digest:string;body:string}|null;if(old?.digest===digest)return JSON.parse(old.body)as ReviewBundle;
 const b=createReviewBundle(input);db.query('INSERT INTO packets VALUES(?,?,?) ON CONFLICT(role_id) DO UPDATE SET digest=excluded.digest,body=excluded.body').run(role,digest,JSON.stringify(b));return b;
 }
 return{path:file,manifest:()=>structuredClone(manifest),
  questions(role:RoleId){RoleIdSchema.parse(role);return manifest.items.filter(i=>i.roleId===role).map(i=>({id:i.id,text:i.question,questionType:i.questionType,difficulty:i.difficulty,answered:!!answer(i.id)}));},
  submit(roleId:RoleId,questionId:string,text:string){const c=FieldAnswerCommandSchema.parse({roleId,questionId,text}),k=item(c.questionId);if(k.roleId!==c.roleId)throw Error('FIELD_ROLE_MISMATCH');
   const at=Date.now();if(at<manifest.consentedAt)throw Error('FIELD_BEFORE_CONSENT');db.transaction(()=>{if(answer(questionId))throw Error('FIELD_ANSWER_IMMUTABLE');const hash=contentHash(c.text.normalize('NFKC').replace(/\s+/g,' ').trim());
    db.query('INSERT INTO answers VALUES(?,?,?,?,?)').run(c.questionId,c.roleId,c.text,hash,at);}).immediate();
  },
  status(){return{studyId:manifest.studyId,participantId:manifest.participantId,origin:manifest.origin,knowledgeStatus:'draft',humanAnswers:(db.query('SELECT COUNT(*) AS n FROM answers').get()as{n:number}).n,
   totalQuestions:16,repeatedAnswerTexts:(db.query('SELECT COUNT(*)-COUNT(DISTINCT normalized_hash) AS n FROM answers').get()as{n:number}).n,modelResults:(db.query('SELECT COUNT(*) AS n FROM scores WHERE snapshot IS NOT NULL').get()as{n:number}).n,qualityVerified:false,identityVerified:false,rsiEffectEstablished:false};},
  scoringRequest(questionId:string,deadlineAt:number){const old=scoreRow(questionId);if(old)return AgentRunRequestSchema.parse(JSON.parse(old.request));const a=answer(questionId),k=item(questionId);if(!a)throw Error('FIELD_ANSWER_MISSING');const now=Date.now();
   const runId=randomUUID(),context={userId:manifest.participantId,roleId:k.roleId,runId,attemptId:'attempt-1',deadlineAt};
   const state=createInterviewState({sessionId:manifest.studyId,roleId:k.roleId,durationMinutes:15,skills:[{skillId:k.skillId,relevance:1}]},now);
   const request=AgentRunRequestSchema.parse({inputSnapshotId:runId,context,job:{type:'turn',allowDraftKnowledge:true,knowledge:[],askedQuestionIds:[k.id],clarification:{policy:{maxClarifications:0,minRemainingSeconds:45}},
    input:{state,expectedVersion:0,observationId:runId,goal:'真实参与者回答的独立评分验收，不证明质量',context,question:{id:k.id,roleId:k.roleId,skillId:k.skillId,text:k.question,questionType:k.questionType,difficulty:k.difficulty},
     answer:{id:k.id,text:a.text},quality:1,rubric:rubric(k.id),knowledge:[]}}});
   db.query('INSERT INTO scores(question_id,request,snapshot) VALUES(?,?,NULL)').run(questionId,JSON.stringify(request));return request;
  },
  async saveScore(questionId:string,raw:unknown,mode:'unverified'|'live-http'|'injected-http'='unverified'){const row=scoreRow(questionId);if(!row)throw Error('FIELD_REQUEST_MISSING');const req=AgentRunRequestSchema.parse(JSON.parse(row.request)),s=AgentRunSnapshotSchema.parse(raw);
   if(s.runId!==req.context.runId||s.attemptId!==req.context.attemptId||s.inputSnapshotId!==req.inputSnapshotId||['queued','running'].includes(s.status))throw Error('FIELD_RESULT_MISMATCH');
   if(row.snapshot){if(contentHash(JSON.parse(row.snapshot))!==contentHash(s))throw Error('FIELD_SCORE_IMMUTABLE');return;}
   if(s.status==='completed'){if(s.result?.kind==='uncommitted-turn-result'&&req.job.type==='turn'){
    const p=s.result.proposal,b=p.basedOn;if(b.questionId!==questionId||b.answerId!==questionId||b.runId!==s.runId||b.attemptId!==s.attemptId||b.sessionId!==manifest.studyId)throw Error('FIELD_RESULT_MISMATCH');
    const context=ScoringContextSchema.parse({...req.context,answerId:questionId,answerText:req.job.input.answer.text,evidence:p.evidence});
    const compute=createScoringExecutor(context,[req.job.input.rubric],{allowRequiredAbstention:true});const receipt=await compute('field-check',{rubricId:p.evaluation.rubricId,rubricVersion:p.evaluation.rubricVersion,criterionScores:p.evaluation.dimensions.map(d=>({criterionId:d.criterionId,score:d.score,evidenceIds:d.evidenceIds}))},undefined,()=>req.context.deadlineAt-1);
    if(!receipt.data||contentHash(receipt.data)!==contentHash(p.evaluation))throw Error('FIELD_SCORE_RECALC_FAILED');
   }else if(s.result?.kind==='uncommitted-unscored-turn-result'){
    const b=s.result.resolution.basedOn;if(b.questionId!==questionId||b.answerId!==questionId||b.runId!==s.runId||b.attemptId!==s.attemptId||b.sessionId!==manifest.studyId)throw Error('FIELD_RESULT_MISMATCH');
   }else throw Error('FIELD_RESULT_MISMATCH');}
   db.query('UPDATE scores SET snapshot=?,mode=? WHERE question_id=? AND snapshot IS NULL').run(JSON.stringify(s),mode,questionId);
  },
  scoreSnapshot(id:string){const r=scoreRow(id);return r?.snapshot?AgentRunSnapshotSchema.parse(JSON.parse(r.snapshot)):null;},
  reviewBundle:bundle,
  reviewReport(role:RoleId,labels:unknown){const b=bundle(role),report=evaluateReviews(b,labels),missing=b.privateManifest.tasks.filter(t=>t.item.modelScore===null).map(t=>t.item.id);
   const nonLive=b.privateManifest.tasks.filter(t=>t.item.payload.modelEvidenceMode!=='live-http').map(t=>t.item.id);
   return{...report,status:missing.length||nonLive.length||b.privateManifest.tasks.length<8?'not_ready' as const:report.status,missingModelScores:missing,nonLiveModelCases:nonLive,roleId:role,knowledgeStatus:'draft',participantCount:1};},
  close(){db.close();},
 };
}
export type FieldSession=ReturnType<typeof openFieldSession>;
