import{pathToFileURL}from'node:url';
import java from'../knowledge/java-backend/seed.json'with{type:'json'};
import web from'../knowledge/web-frontend/seed.json'with{type:'json'};
import{createInterviewState}from'../apps/agent/src/planning/interview-state.ts';
import{selectNextQuestion}from'../apps/agent/src/planning/select-question.ts';
import{evaluateTurn}from'../apps/agent/src/orchestration/evaluate-turn.ts';
import{buildInterviewReport}from'../apps/agent/src/reporting/build-report.ts';
import{createEvaluationFixture}from'../experiments/pi-sdk/evaluation-fixture.ts';
import{createPiEvaluator}from'../apps/agent/src/adapters/pi/evaluator.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
import type{ReportInputSchema}from'../packages/contracts/src/report.ts';
import type{z}from'zod';

/** Fixed hand-written grades exercise the SDK/contract/math, never semantic grading quality. */
export async function runContentRubricsDemo(roleId:RoleId='java-backend'){
 const knowledge=roleId==='java-backend'?java:web,now=Date.now();
 let state=createInterviewState({sessionId:`content-${roleId}`,roleId,durationMinutes:20,
  skills:[{skillId:'project-design',relevance:1},{skillId:'collaboration',relevance:.99}]},now);
 const policy={id:'multidimension-v1',roleId,parameters:{maxFollowupDepth:1,maxTurns:12,wrapUpSeconds:30}};
 const turns:z.infer<typeof ReportInputSchema>['turns']=[],asked:string[]=[];let anchorsInPrompt=0,providerCalls=0;
 for(let i=0;i<2;i++){
  const selection=selectNextQuestion({state,now:Date.now(),knowledge,askedQuestionIds:asked,planningPolicy:policy},{allowDraftKnowledge:true});
  if(selection.status!=='selected')throw new Error('Expected project and behavioral coverage');
  const text=selection.question.questionType==='project'
   ?(roleId==='java-backend'?'我负责容量校验与写入边界，用事务保护不变量，并设计并发请求验证。测试仅在本地完成，生产效果未验证。':'我负责组件状态边界，先记录渲染次数再调整依赖，并检查交互回归。仅验证本地设备，其他设备未测。')
   :'下面是假设案例。我先确认影响与约束，再与同伴列出选项和负责人，解释取舍并约定验收与复盘。这不是实际经历。';
  const fixture=await createEvaluationFixture(context=>{
   const user=context.messages.filter(m=>m.role==='user').at(-1)!;
   const payload=typeof user.content==='string'?user.content:user.content.filter(c=>c.type==='text').map(c=>c.text).join('');
   const data=JSON.parse(payload)as{rubric:{criteria:{anchors?:unknown[]}[]}};
   anchorsInPrompt+=data.rubric.criteria.filter(c=>c.anchors?.length===5).length;
   return{text:JSON.stringify({evidence:selection.rubric.criteria.map((c,j)=>({id:`e${j}`,start:j*4,end:j*4+4,excerpt:text.slice(j*4,j*4+4)})),
    criterionScores:selection.rubric.criteria.map((c,j)=>({criterionId:c.id,score:[4,2,1,3][j],evidenceIds:[`e${j}`]})),
    feedback:{strengths:['本地手工评分演示'],improvements:['需要人工参考集核验维度语义和引文支持关系']}})};
  });
  const input={state,expectedVersion:state.version,observationId:`o${i}`,goal:'项目与行为题离线联调',
   context:{userId:'fixture-user',runId:`content-${roleId}-${i}`,attemptId:'a1',roleId,deadlineAt:now+60000},
   question:selection.question,answer:{id:`answer${i}`,text},quality:.8,rubric:selection.rubric,knowledge:[],planningPolicy:policy};
  const proposal=await evaluateTurn(input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:fixture.runtime,model:fixture.model,roleId})});
  turns.push({input,proposal,evidenceMode:'offline-fixture'});state=proposal.nextState;asked.push(selection.question.id);providerCalls+=fixture.stats.providerCalls;
 }
 const report=await buildInterviewReport({state,generatedAt:Date.now(),policyVersion:policy.id,
  skillLabels:{'project-design':'项目论证','collaboration':'协作叙述'},turns});
 return{roleId,mode:'real-pi-local-handwritten-grades',liveModelCalls:0,committed:false,providerCalls,anchorsInPrompt,
  scope:report.scope,questionTypes:report.assessments.map(a=>a.questionType),
  scopes:report.assessments.map(a=>a.evaluation.scope),scores:report.assessments.map(a=>a.evaluation.normalizedScore),
  criteria:report.assessments.map(a=>a.rubric.criteria.map(c=>({id:c.id,dimension:c.dimension,weight:c.weight}))),
  report,reportInput:{state,generatedAt:report.generatedAt,policyVersion:policy.id,
    skillLabels:{'project-design':'项目论证','collaboration':'协作叙述'},turns}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend']as const){const{report,reportInput,...summary}=await runContentRubricsDemo(role);console.log(JSON.stringify(summary,null,2));}
}
