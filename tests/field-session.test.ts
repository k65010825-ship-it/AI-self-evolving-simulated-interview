import {test,expect} from 'bun:test';import {mkdtempSync,readdirSync,unlinkSync,rmdirSync,writeFileSync,readFileSync} from 'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import {createFieldSession,openFieldSession} from '../apps/agent/src/field/session.ts';
import {createOfflineRunManager} from '../apps/agent/src/runtime/offline-runtime.ts';
function fixture(){const dir=mkdtempSync(join(tmpdir(),'field-session-'));return{dir,path:join(dir,'study.sqlite'),close(){for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}};}
test('two roles freeze eight questions each, without exposing rubric/key points to participant',()=>{const f=fixture();const s=createFieldSession(f.path,{participantId:'student-self',consentRecordId:'consent-1',consentedAt:Date.now(),developmentReviewerIds:['content-author']});try{
 for(const role of ['java-backend','web-frontend'] as const){const qs=s.questions(role);expect(qs).toHaveLength(8);expect(new Set(qs.map(q=>q.questionType)).size).toBe(4);expect(JSON.stringify(qs)).not.toMatch(/rubric|keyPoints|answerGuide|modelScore/);}
 expect(s.status().humanAnswers).toBe(0);expect(s.status().qualityVerified).toBe(false);
}finally{s.close();f.close();}});
test('consent is required and duplicate create never destroys existing study',()=>{const f=fixture();expect(()=>createFieldSession(f.path,{participantId:'x',consentRecordId:'',consentedAt:Date.now(),developmentReviewerIds:[]})).toThrow();
 const s=createFieldSession(f.path,{participantId:'x',consentRecordId:'c',consentedAt:Date.now(),developmentReviewerIds:[]});try{expect(()=>createFieldSession(f.path,{participantId:'other',consentRecordId:'c',consentedAt:Date.now(),developmentReviewerIds:[]})).toThrow();expect(s.status().participantId).toBe('x');}finally{s.close();f.close();}});
test('answers survive reopen, remain immutable, reject wrong roles and flag repeated answers without inventing replacements',()=>{const f=fixture();let s=createFieldSession(f.path,{participantId:'x',consentRecordId:'c',consentedAt:Date.now(),developmentReviewerIds:[]});try{
 const q=s.questions('java-backend')[0]!,other=s.questions('web-frontend')[0]!;
 expect(()=>s.submit('web-frontend',q.id,'跨岗回答应拒绝。')).toThrow();
 s.submit('java-backend',q.id,'我会先确认事务边界，再处理缓存更新失败。');
 expect(()=>s.submit('java-backend',q.id,'改成另一个回答')).toThrow();
 s.submit('web-frontend',other.id,'  我会先确认事务边界，再处理缓存更新失败。  ');
 s.close();s=openFieldSession(f.path);expect(s.status().humanAnswers).toBe(2);expect(s.status().repeatedAnswerTexts).toBe(1);expect(s.questions('java-backend')[0]!.answered).toBe(true);
 const b=s.reviewBundle('java-backend');expect(b.reviewPacket.tasks).toHaveLength(1);expect(JSON.stringify(b.reviewPacket)).not.toContain('modelScore');expect(b.privateManifest.tasks[0]!.item.modelScore).toBeNull();
 expect(s.reviewReport('java-backend',[]).status).toBe('not_ready');
}finally{s.close();f.close();}});
test('pending review exports contain both role rubric and original answer but no hidden model score',()=>{const f=fixture();const s=createFieldSession(f.path,{participantId:'x',consentRecordId:'c',consentedAt:Date.now(),developmentReviewerIds:['reviewer-a']});try{
 for(const role of ['java-backend','web-frontend']as const){const q=s.questions(role)[0]!;s.submit(role,q.id,role==='java-backend'?'我会先确认事务边界并设计失败重试。':'我会用递增序号防止过期请求覆盖当前状态。');
 const b=s.reviewBundle(role),t=b.reviewPacket.tasks[0]!;expect(t.roleId).toBe(role);expect(t.payload.rubric).toBeDefined();expect(t.payload.answer).toBeDefined();expect(t.sourceReferences.length).toBeGreaterThan(0);
 const labels=['reviewer-a','reviewer-b'].map((r,i)=>({taskId:t.taskId,taskDigest:t.taskDigest,reviewId:'r'+i,reviewerId:r,reviewedAt:new Date().toISOString(),humanScore:.5,citationSupported:true,continuationAccurate:null,answerLeaked:false,expressionReliable:null,rationale:'本地合成测试标签，不是真人专家验收'}));
 expect(()=>s.reviewReport(role,labels)).toThrow('FIELD_EVIDENCE_REVIEWER_CONTAMINATION');}
}finally{s.close();f.close();}});

test('saved scoring request is immutable and runtime results are bound and recomputed',async()=>{
 const f=fixture(),s=createFieldSession(f.path,{participantId:'x',consentRecordId:'c',consentedAt:Date.now(),developmentReviewerIds:[]}),runtime=await createOfflineRunManager();
 try{const q=s.questions('java-backend')[0]!;s.submit('java-backend',q.id,'我会先确认业务边界，并用幂等和监控处理失败。');
 const req=s.scoringRequest(q.id,Date.now()+60000);expect(s.scoringRequest(q.id,Date.now()+30000)).toEqual(req);
 runtime.start(req);await runtime.wait(req.context.runId);const snapshot=runtime.snapshot(req.context.runId);expect(snapshot.status).toBe('completed');
 const tampered=structuredClone(snapshot);tampered.runId='wrong';await expect(s.saveScore(q.id,tampered)).rejects.toThrow('FIELD_RESULT_MISMATCH');
 await s.saveScore(q.id,snapshot);expect(s.scoreSnapshot(q.id)).toEqual(snapshot);await s.saveScore(q.id,snapshot);
 const b=s.reviewBundle('java-backend');expect(b.privateManifest.tasks[0]!.item.modelScore).toBe(.5);expect(JSON.stringify(b.reviewPacket)).not.toContain('normalizedScore');
 }finally{runtime.dispose();s.close();f.close();}
});
