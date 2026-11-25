import {createHash} from 'node:crypto';
import defaultResources from '../../../../knowledge/resources.json' with {type:'json'};
import {ROLE_CATALOG_VERSION,roleSkillDefinitions,roleSkillLabels} from '../../../../packages/contracts/src/role-catalog.ts';
import type {RoleId} from '../../../../packages/contracts/src/tools.ts';
import type {MemorySnapshot} from '../../../../packages/contracts/src/memory.ts';
import type {InterviewWorkflow} from '../../../../packages/contracts/src/session-workflow.ts';
import {ResourceCatalogSchema} from '../../../../packages/contracts/src/resources.ts';
import {LocalProfileQuerySchema,LocalProfileViewSchema,LocalPracticeRecommendationsQuerySchema,LocalPracticeRecommendationsViewSchema,
 LocalReflectionListQuerySchema,LocalReflectionListViewSchema,type LocalProfileView,type LocalPracticeRecommendationsView,type LocalReflectionListView} from '../../../../packages/contracts/src/local-presentation.ts';
import {estimateSkills} from '../planning/interview-state.ts';
import {historyEligibility} from '../memory/history-compatibility.ts';
import {buildPracticeGoals} from '../learning/practice-plan.ts';
import {recommendResources} from '../reporting/recommend-resources.ts';
import {seedHistoryCompatibility} from '../tools/knowledge-executor.ts';
import {LocalError} from './profile-store.ts';

const clip=(text:string,max:number)=>{let s=text.slice(0,max);if(s.length<text.length&&/[\uD800-\uDBFF]$/.test(s))s=s.slice(0,-1);return s;};
const digestOf=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function page<T>(items:T[],offset:number,limit:number){const rows=items.slice(offset,offset+limit);return{offset,limit,total:items.length,nextOffset:offset+rows.length<items.length?offset+rows.length:null,rows};}
const goalActions={
 no_evidence:'先完成该技能的基础学习并参加诊断练习，补充可评分的独立回答证据。',
 weak_evidence:'聚焦该技能的关键原理、边界条件与失败恢复，梳理后再做不同题复测。',
 uncertain_evidence:'在不同场景下用未见题复核掌握稳定性；单次作答或重复原题不证明已掌握。',
} as const;

export type LearningStatusLookup=(roleId:RoleId,skillId:string)=>'unavailable'|'not_started'|'in_progress'|'self_reported'|'verified_complete';

export function buildProfileView(input:{memory:MemorySnapshot;workflows:InterviewWorkflow[];assetsRoot:string;now:number;rawQuery:unknown}):LocalProfileView{
 const q=LocalProfileQuerySchema.safeParse(input.rawQuery);
 if(!q.success)throw new LocalError('VALIDATION_ERROR');
 if(q.data.expectedMemoryVersion!==undefined&&q.data.expectedMemoryVersion!==input.memory.version)throw new LocalError('VERSION_CONFLICT');
 const roleId=q.data.roleId,defs=roleSkillDefinitions(roleId),skillLabels=roleSkillLabels(roleId);
 const committed=input.workflows.filter(w=>w.identity.roleId===roleId&&w.phase==='completed'&&w.closeout).sort((a,b)=>b.closeout!.generatedAt-a.closeout!.generatedAt||(a.state.sessionId<b.state.sessionId?1:-1));
 const latestCompat=committed[0]?.state.historyCompatibility??seedHistoryCompatibility(roleId,defs.map(d=>d.skillId));
 const allPrior=input.memory.sessions.flatMap(s=>s.observations);
 const history=historyEligibility(allPrior,latestCompat);
 const syntheticState={schemaVersion:1 as const,sessionId:'profile-view-'+roleId,roleId,version:0,startedAt:input.now,deadlineAt:input.now+1200000,
  skills:defs.map(({skillId,relevance})=>({skillId,relevance})),observations:[],currentSkillId:null,followupDepth:0,difficulty:2,
  priorEvidence:allPrior,historyCompatibility:latestCompat};
 const estimates=new Map(estimateSkills(syntheticState,input.now).map(e=>[e.skillId,e]));
 const toSkillView=(d:typeof defs[number])=>{
  const est=estimates.get(d.skillId),skillPrior=allPrior.filter(o=>o.skillId===d.skillId);
  const assistedExcludedCount=skillPrior.filter(o=>o.assistance||history.anchors.get(o.questionId)?.assistance).length;
  const incompatibleExcludedCount=skillPrior.filter(o=>!o.assistance&&!history.anchors.get(o.questionId)?.assistance&&!history.eligibleQuestionIds.has(o.questionId)).length;
  return{skillId:d.skillId,label:d.label,category:d.category,mastery:est?.mastery??null,confidence:est?.confidence??0,
   independentQuestions:est?.independentQuestions??0,assistedExcludedCount,incompatibleExcludedCount};
 };
 const points=input.memory.sessions.map(ms=>{
  const wf=committed.find(w=>w.state.sessionId===ms.sessionId);
  const bySkill=new Map<string,{scores:number[];rubrics:Set<string>;assisted:number}>();
  for(const o of ms.observations){
   const g=bySkill.get(o.skillId)??{scores:[],rubrics:new Set<string>(),assisted:0};
   if(o.assistance)g.assisted++;else g.scores.push(o.score);
   g.rubrics.add(`${o.rubricId}@${o.rubricVersion}`);
   bySkill.set(o.skillId,g);
  }
  const skillScores=[...bySkill.entries()].map(([skillId,g])=>({skillId,label:skillLabels[skillId]??skillId,
   averageScore:g.scores.length?g.scores.reduce((a,b)=>a+b,0)/g.scores.length:null,
   rubricVersions:[...g.rubrics].sort(),assistedCount:g.assisted})).sort((a,b)=>a.skillId.localeCompare(b.skillId));
  return{sessionId:ms.sessionId,endedAt:ms.endedAt,policyVersion:ms.policyVersion,evidenceMode:ms.evidenceMode,
   scoredAnswers:ms.observations.length,independentQuestions:ms.observations.filter(o=>!o.assistance).length,
   rubricScope:wf?.closeout?.report.scope??null,skillScores};
 }).sort((a,b)=>b.endedAt-a.endedAt||(a.sessionId<b.sessionId?1:-1));
 const paged=page(points,q.data.offset,q.data.limit);
 const warnings=[
  '成长点按各场提交时的量规与策略版本独立记录；不同量规或证据模式不可直接画作绝对提分曲线。',
  ...(allPrior.some(o=>o.assistance)?['提示辅助作答已保留标记，并从独立掌握度与置信度统计中排除。']:[]),
 ];
 return LocalProfileViewSchema.parse({
  presentationVersion:1,roleId,catalogVersion:ROLE_CATALOG_VERSION,generatedAt:input.now,memoryVersion:input.memory.version,
  sourceDigest:digestOf({roleId,memoryVersion:input.memory.version,sessions:points.map(p=>p.sessionId)}),
  mainSkills:defs.filter(d=>d.category==='main').map(toSkillView),
  behavioralSkills:defs.filter(d=>d.category==='behavioral').map(toSkillView),
  growthPage:{offset:paged.offset,limit:paged.limit,total:paged.total,nextOffset:paged.nextOffset},
  growthPoints:paged.rows,warnings,
 });
}

export async function buildPracticeRecommendationsView(input:{memory:MemorySnapshot;workflows:InterviewWorkflow[];assetsRoot:string;now:number;rawQuery:unknown;learningAvailable:boolean;learningStatus?:LearningStatusLookup}):Promise<LocalPracticeRecommendationsView>{
 const q=LocalPracticeRecommendationsQuerySchema.safeParse(input.rawQuery);
 if(!q.success)throw new LocalError('VALIDATION_ERROR');
 const roleId=q.data.roleId,defs=roleSkillDefinitions(roleId),skillLabels=roleSkillLabels(roleId);
 const committed=input.workflows.filter(w=>w.identity.roleId===roleId&&w.phase==='completed'&&w.closeout).sort((a,b)=>b.closeout!.generatedAt-a.closeout!.generatedAt||(a.state.sessionId<b.state.sessionId?1:-1));
 const latestCompat=committed[0]?.state.historyCompatibility??seedHistoryCompatibility(roleId,defs.map(d=>d.skillId));
 const session={sessionId:'practice-advice-'+roleId,roleId,durationMinutes:20,historyCompatibility:latestCompat,skills:defs.map(({skillId,relevance})=>({skillId,relevance}))};
 const goalsResult=buildPracticeGoals(input.memory,{userId:input.memory.userId,roleId,session,now:input.now,maxGoals:q.data.maxGoals});
 const catalog=ResourceCatalogSchema.parse(defaultResources);
 const syntheticReportInput={
  state:{schemaVersion:1 as const,sessionId:'practice-advice-'+roleId,roleId,version:0,startedAt:input.now,deadlineAt:input.now+1200000,
   skills:defs.map(({skillId,relevance})=>({skillId,relevance})),observations:[],currentSkillId:null,followupDepth:0,difficulty:2,priorEvidence:[]},
  generatedAt:input.now,policyVersion:'practice-recommendations-v1',
  skillLabels:Object.fromEntries(defs.map(d=>[d.skillId,d.label])),turns:[],
 };
 const fakeReport={
  schemaVersion:1 as const,kind:'uncommitted-content-report' as const,sessionId:syntheticReportInput.state.sessionId,sessionVersion:0,roleId,
  generatedAt:input.now,policyVersion:'practice-recommendations-v1',evidenceMode:'unverified' as const,scope:'technical-content' as const,
  coverage:{totalSkills:defs.length,observedSkills:0,totalAnswers:0,independentQuestions:0},
  skills:defs.map(d=>({skillId:d.skillId,label:d.label,mastery:null,confidence:0,independentQuestions:0,rubricVersions:[]})),
  assessments:[],expression:{status:'not_evaluated' as const,reason:'no_confirmed_audio' as const,speechRate:null,clarity:null,confidence:null},
  studyPlan:goalsResult.goals.slice(0,3).map(g=>({
   skillId:g.skillId,label:skillLabels[g.skillId]??g.skillId,
   reason:g.reason==='no_evidence'?'assess_unknown' as const:g.reason==='weak_evidence'?'repair_gap' as const:'verify_uncertainty' as const,
   minutes:g.reason==='no_evidence'?15:25,actions:[goalActions[g.reason]],evidenceAnswerIds:[],
   retest:{requireDifferentQuestion:true as const,excludeQuestionIds:goalsResult.excludedQuestionIds,successCriteria:'使用未见题验证该技能的边界分析与取舍。'},
  })),
  resourceRecommendations:[],warnings:[],
 };
 const enriched=await recommendResources(fakeReport,{userId:input.memory.userId,roleId,runId:'practice-advice',attemptId:'a1',deadlineAt:input.now+10000},catalog,{now:()=>input.now,allowDraftResources:true});
 const statusOf=(skillId:string)=>!input.learningAvailable?'unavailable' as const:(input.learningStatus?.(roleId,skillId)??'not_started');
 const goals=goalsResult.goals.map(g=>({
  skillId:g.skillId,label:skillLabels[g.skillId]??g.skillId,mastery:g.mastery,confidence:g.confidence,priority:g.priority,
  reason:g.reason,action:goalActions[g.reason],learningStatus:statusOf(g.skillId),
 }));
 const resources=enriched.report.resourceRecommendations.map(r=>({
  skillId:r.skillId,reason:r.reason,explanation:r.explanation,catalogVersion:r.catalogVersion,learningStatus:statusOf(r.skillId),resource:r.resource,
 }));
 const warnings=[
  ...(!input.learningAvailable?['未接入正式学习持久存储，练习完成状态返回 unavailable，不会伪造 not_started。']:[]),
  ...(resources.some(r=>r.resource.reviewStatus==='draft')?['当前推荐资源仍处于 draft 状态，尚未经过团队正式审核。']:[]),
  ...enriched.report.warnings.filter(w=>w.startsWith('resource_gap:')).map(w=>`技能 ${w.slice('resource_gap:'.length)} 暂无匹配学习资源。`),
 ];
 return LocalPracticeRecommendationsViewSchema.parse({
  presentationVersion:1,roleId,generatedAt:input.now,memoryVersion:input.memory.version,
  sourceDigest:digestOf({roleId,memoryVersion:input.memory.version,goals:goals.map(g=>[g.skillId,g.reason]),resources:resources.map(r=>r.resource.id)}),
  learningProgressAvailable:input.learningAvailable,goals,resources,warnings,
 });
}

export function buildReflectionListView(input:{workflows:InterviewWorkflow[];now:number;rawQuery:unknown}):LocalReflectionListView{
 const q=LocalReflectionListQuerySchema.safeParse(input.rawQuery);
 if(!q.success)throw new LocalError('VALIDATION_ERROR');
 const roleId=q.data.roleId;
 const items=input.workflows.filter(w=>w.identity.roleId===roleId&&w.phase==='completed'&&w.closeout)
  .sort((a,b)=>b.closeout!.generatedAt-a.closeout!.generatedAt||(a.state.sessionId<b.state.sessionId?1:-1))
  .map(w=>{
   const r=w.closeout!.reflection;
   return{sessionId:r.sessionId,generatedAt:r.generatedAt,policyVersion:r.baselinePolicy.id,evidenceMode:r.evidenceMode,
    metrics:r.metrics,findings:r.findings.map(f=>({code:f.code,count:f.observationIds.length})),
    candidate:r.candidate?{id:r.candidate.id,baselineId:r.candidate.baselineId,changes:r.candidate.changes}:null,
    ...(r.planning?{planning:r.planning}:{})};
  });
 const sourceDigest=digestOf({roleId,items:items.map(i=>[i.sessionId,i.generatedAt,i.policyVersion])});
 if(q.data.expectedSourceDigest!==undefined&&q.data.expectedSourceDigest!==sourceDigest)throw new LocalError('VERSION_CONFLICT');
 const paged=page(items,q.data.offset,q.data.limit);
 return LocalReflectionListViewSchema.parse({
  presentationVersion:1,roleId,generatedAt:input.now,sourceDigest,deploymentStatus:'not_published',
  calibration:{status:'unavailable',mae:null,minimumPairs:8,minimumStudents:2,reason:clip('单机本地 profile 不具备跨学生（至少 2 名学生、8 组配对）校准条件；仅展示逐场策略反思指标。',240)},
  page:{offset:paged.offset,limit:paged.limit,total:paged.total,nextOffset:paged.nextOffset},items:paged.rows,
 });
}
