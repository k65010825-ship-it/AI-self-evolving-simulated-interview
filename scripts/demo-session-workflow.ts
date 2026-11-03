import{pathToFileURL}from'node:url';
import{createWorkflowFixture}from'../experiments/session/fixture.ts';
import{createInterviewWorkflow,planInterviewQuestion,submitInterviewAnswer,finishInterviewWorkflow}from'../apps/agent/src/orchestration/session-workflow.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
export async function runSessionWorkflowDemo(roleId:RoleId='java-backend'){
 const now=Date.now(),identity={userId:'workflow-fixture',roleId},deps=await createWorkflowFixture(roleId);
 let session=createInterviewWorkflow({identity,session:{sessionId:`workflow-${roleId}`,roleId,durationMinutes:20,
  skills:[{skillId:'project-design',relevance:1},{skillId:'collaboration',relevance:.99}]},
  policy:{id:'workflow-v1',roleId,parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},goal:'完整会话离线联调',
  skillLabels:{'project-design':'项目论证',collaboration:'协作叙述'},allowDraftKnowledge:true,now});
 for(let i=0;i<2;i++){
  const context={...identity,runId:`plan-${i}`,attemptId:'a1',deadlineAt:now+60000};
  session=await planInterviewQuestion(session,{identity,expectedRevision:session.revision,context},{plan:deps.plan});
  session=await submitInterviewAnswer(session,{identity,expectedRevision:session.revision,context:{...context,runId:`answer-${i}`},observationId:`o${i}`,
   answer:{id:`answer${i}`,text:i===0?'我负责项目方案的约束分析和验证，测试只在本地完成。':'下面是假设案例，先确认影响与约束，再协商行动与验收。'},
   quality:.8,evidenceMode:'offline-fixture'},{evaluate:deps.evaluate});
 }
 session=await finishInterviewWorkflow(session,{identity,expectedRevision:session.revision,mode:'automatic',sourceGroupId:`fixture-${roleId}`});
 return{session,liveModelCalls:deps.stats.planning.liveModelCalls+deps.stats.scoring.liveModelCalls,
  planningCalls:deps.stats.planning.providerCalls,scoringCalls:deps.stats.scoring.providerCalls,committed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend']as const){const d=await runSessionWorkflowDemo(role);console.log(JSON.stringify({role,
  phase:d.session.phase,revision:d.session.revision,observations:d.session.state.observations.length,
  reason:d.session.closeout?.reason,reportScope:d.session.closeout?.report.scope,memoryVersion:d.session.closeout?.memoryCandidate.version,
  reflection:d.session.closeout?.reflection.kind,planningCalls:d.planningCalls,scoringCalls:d.scoringCalls,
  liveModelCalls:d.liveModelCalls,committed:false},null,2));}
}
