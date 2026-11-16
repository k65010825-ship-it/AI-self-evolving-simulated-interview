import type {InterviewWorkflow} from '../../../../packages/contracts/src/session-workflow.ts';
import {LocalReadPageOptionsSchema,LocalAnswerViewSchema,LocalAnswerPageSchema,LocalReportViewSchema,LocalSessionPresentationSchema,type LocalReadPageOptions,type LocalAnswerView} from '../../../../packages/contracts/src/local-presentation.ts';
import {projectFeedbackPublication} from '../../../../packages/interview-domain/src/feedback-publication.ts';
import {LocalError} from './profile-store.ts';
type Turn=InterviewWorkflow['turns'][number];
const studyActions={assess_unknown:'先完成该技能的基础练习，补充可评分的回答证据。',repair_gap:'围绕该技能重新组织关键判断、理由和处理过程，再做不同题复测。',verify_uncertainty:'使用不同题复测该技能；一次作答或重复原题不能证明掌握。'};
const labels={correctness:'技术正确性',depth:'知识深度',ownership:'项目职责',logic:'表达逻辑',communication:'沟通表达',relevance:'岗位相关性',verification:'验证能力'};
const clip=(text:string,max:number)=>{let s=text.slice(0,max);if(s.length<text.length&&/[\uD800-\uDBFF]$/.test(s))s=s.slice(0,-1);return s;};
function options(w:InterviewWorkflow|null,raw:LocalReadPageOptions){const p=LocalReadPageOptionsSchema.safeParse(raw);if(!p.success)throw new LocalError('VALIDATION_ERROR');if(p.data.expectedRevision!==undefined&&p.data.expectedRevision!==(w?.revision??-1))throw new LocalError('VERSION_CONFLICT');return p.data;}
function page<T>(items:T[],p:{offset:number;limit:number}){const rows=items.slice(p.offset,p.offset+p.limit);return{offset:p.offset,limit:p.limit,total:items.length,nextOffset:p.offset+rows.length<items.length?p.offset+rows.length:null,rows};}
function scoredView(turn:Turn):LocalAnswerView{
 // Reuse the publication gate, not raw model feedback or unreviewed criterion action/anchors.
 const {input,proposal,evidenceMode}=turn,publication=projectFeedbackPublication(input,proposal),score=proposal.evaluation;
 const wanted=new Set(score.dimensions.flatMap(d=>d.evidenceIds));const refs=proposal.evidence.filter(e=>wanted.has(e.id));
 if(refs.length!==wanted.size)throw new LocalError('LOCAL_DATA_INVALID');
 const evidence=refs.slice(0,3).map(e=>{if(input.answer.text.slice(e.start,e.end)!==e.excerpt)throw new LocalError('LOCAL_DATA_INVALID');const excerpt=clip(e.excerpt,240);return{id:e.id,answerId:input.answer.id,start:e.start,end:e.start+excerpt.length,excerpt,truncated:excerpt.length!==e.excerpt.length};});
 return LocalAnswerViewSchema.parse({questionId:input.question.id,questionText:input.presentedText??input.question.text,answerId:input.answer.id,status:'scored',reason:null,rubricVersion:input.rubric.version,scope:input.rubric.scope,semanticSupport:'not_verified',normalizedScore:score.normalizedScore,evidenceMode,
 strengths:publication.feedback.strengths,improvements:publication.feedback.improvements,feedbackStatus:publication.publication.disposition,withheldFeedbackCount:publication.publication.withheldCount,
 criteria:score.dimensions.map(d=>{const c=input.rubric.criteria.find(c=>c.id===d.criterionId);if(!c)throw new LocalError('LOCAL_DATA_INVALID');return{id:d.criterionId,label:c.dimension?labels[c.dimension]:'评价项',dimension:c.dimension??null,score:d.score,maxScore:c.maxScore,action:null};}),evidence,evidenceOmitted:refs.length-evidence.length});
}
type Entry={questionId:string;scored?:Turn;unscored?:NonNullable<InterviewWorkflow['clarificationAttempts']>[number]};
function entries(w:InterviewWorkflow):Entry[]{return w.issuedQuestions.flatMap<Entry>(q=>{
 const scored=w.turns.find(t=>t.input.question.id===q.questionId);if(scored)return[{questionId:q.questionId,scored}];
 const unscored=w.clarificationAttempts?.filter(t=>t.input.question.id===q.questionId).at(-1);return unscored?[{questionId:q.questionId,unscored}]:[];
});}
function answerView(e:ReturnType<typeof entries>[number]):LocalAnswerView{if(e.scored)return scoredView(e.scored);const {input,resolution,evidenceMode}=e.unscored!;return LocalAnswerViewSchema.parse({questionId:input.question.id,questionText:input.presentedText??input.question.text,answerId:input.answer.id,status:resolution.status,reason:resolution.reason,rubricVersion:input.rubric.version,scope:input.rubric.scope,semanticSupport:'not_verified',normalizedScore:null,evidenceMode,strengths:[],improvements:[],feedbackStatus:'not-scored',withheldFeedbackCount:0,criteria:[],evidence:[],evidenceOmitted:0});}
export function localSessionPresentation(w:InterviewWorkflow|null,summary=false){const rows=w?entries(w):[],last=rows.at(-1),pending=w?.current?w.clarificationAttempts?.filter(a=>a.input.question.id===w.current!.question.id).at(-1):undefined;
 return LocalSessionPresentationSchema.parse({presentationVersion:1,needsClarification:pending?.resolution.status==='needs_clarification',submittedCount:rows.length,scoredCount:w?.turns.length??0,unscoredCount:rows.filter(r=>!r.scored).length,
 clarification:!summary&&pending?.resolution.status==='needs_clarification'?{questionId:pending.input.question.id,prompt:pending.resolution.clarification!,previousText:pending.input.answer.text}:null,lastAnswer:!summary&&last?answerView(last):null});}
export function localAnswerPage(w:InterviewWorkflow|null,raw:LocalReadPageOptions={},sessionId=w?.state.sessionId??'uninitialized'){
 const p=options(w,raw),result=page(w?entries(w):[],p);return LocalAnswerPageSchema.parse({presentationVersion:1,sessionId,revision:w?.revision??-1,offset:p.offset,limit:p.limit,total:result.total,nextOffset:result.nextOffset,items:result.rows.map(answerView)});}
export function localReport(w:InterviewWorkflow|null,raw:LocalReadPageOptions={}){const p=options(w,raw),report=w?.closeout?.report;if(!report||!w)return null;const result=page(w.turns,p);
 return LocalReportViewSchema.parse({presentationVersion:1,sessionId:w.state.sessionId,revision:w.revision,generatedAt:report.generatedAt,policyVersion:report.policyVersion,aggregation:'per-answer-only',evidenceMode:report.evidenceMode,coverage:{totalAnswers:report.coverage.totalAnswers,scoredAnswers:report.coverage.scoredAnswers??report.assessments.length,unscoredAnswers:report.coverage.unscoredAnswers??0},
 skills:report.skills.map(s=>({skillId:s.skillId,label:s.label,mastery:s.mastery,confidence:s.confidence})),answers:result.rows.map(scoredView),answerPage:{offset:p.offset,limit:p.limit,total:result.total,nextOffset:result.nextOffset},
 studyPlan:report.studyPlan.map(p=>({skillId:p.skillId,label:p.label,minutes:p.minutes,actions:[studyActions[p.reason]]})),unscoredAnswers:(report.unscoredAnswers??[]).map(a=>({questionId:a.questionId,reason:a.reason})),
 warnings:[...report.warnings.slice(0,20).map(w=>clip(w,160)),'逐题量规评分，不跨量规合成总分；引用位置有效不等于独立语义审核。',report.evidenceMode==='offline-fixture'?'离线固定provider；评分语义未验证':'模型评分候选已过结构校验；评分语义仍需独立审核'],expression:{status:report.expression.status,summary:report.expression.status==='audio_descriptions'?['已确认音频提供语速、停顿等描述性观察；清晰度、自信度和情感未作可靠评分。','音频来源：'+report.expression.speechEvidenceMode]:['没有已确认音频，表达维度未评估。']}});
}
