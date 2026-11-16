import{randomBytes}from'node:crypto';
import{pathToFileURL}from'node:url';
import{createAgentApp}from'../apps/agent/src/app.ts';
import{createOfflineRunManager}from'../apps/agent/src/runtime/offline-runtime.ts';
import type{AgentRunManager}from'../apps/agent/src/runtime/run-manager.ts';
import{createAgentClient}from'../packages/agent-client/src/index.ts';
import{workflowCommitDigest}from'../packages/agent-client/src/workflow-commit.ts';
import{createWorkflowCommitFixtureStore}from'../experiments/commit/fixture-store.ts';
import{createMemory}from'../apps/agent/src/memory/session-memory.ts';
import{WorkflowStoredRowSchema,type WorkflowCommitPlan,type WorkflowCommitReceipt}from'../packages/contracts/src/workflow-commit.ts';
import{AgentRunRequestSchema,type AgentRunRequest,type AgentRunSnapshot}from'../packages/contracts/src/agent-run.ts';
import type{WorkflowOperation}from'../packages/contracts/src/workflow-job.ts';
import type{RoleId,ToolContext}from'../packages/contracts/src/tools.ts';
import{mkdir,writeFile,readFile}from'node:fs/promises';
import{join}from'node:path';

/** API-owned CAS fixture plus caller-owned JSON round trip; never a formal database commit. */
export async function runWorkflowDeliveryDemo(roleId:RoleId='java-backend',options:{runtime?:AgentRunManager;evidenceMode?:'offline-fixture'|'live-model';
 transport?:'in-process'|'tcp';persistRoundTrip?:(row:WorkflowCommitPlan['sessionWrite'])=>Promise<unknown>;
 onQuestionAppliedInFixture?:(row:WorkflowCommitPlan['sessionWrite'],receipt:WorkflowCommitReceipt)=>Promise<void>}={}){
 const own=!options.runtime;if(!own&&!options.evidenceMode)throw Error('EXPLICIT_EVIDENCE_MODE_REQUIRED');
 const runtime=options.runtime??await createOfflineRunManager({planning:'pi-knowledge',questionDelivery:'natural-bridge'}),mode=options.evidenceMode??'offline-fixture';
 const now=Date.now(),identity={userId:'workflow-delivery-synthetic',roleId},sessionId=`delivery-${roleId}`,memory=createMemory(identity,now);
 const store=createWorkflowCommitFixtureStore({identity,sessionId,memory}),token=randomBytes(32).toString('hex');
 const app=createAgentApp({runtime,internalToken:token}),server=options.transport==='tcp'?Bun.serve({hostname:'127.0.0.1',port:0,fetch:app.fetch}):undefined;
 const client=createAgentClient({baseUrl:server?`http://127.0.0.1:${server.port}`:'http://agent.local',internalToken:token,
  fetch:async(url,init)=>server?fetch(url,init):app.request(new Request(url,init))});
 const audit:{request:AgentRunRequest;run:AgentRunSnapshot}[]=[];let count=0,eventCount=0;
 const roundTrip=async()=>{const row=store.current().session!,loaded=WorkflowStoredRowSchema.parse(options.persistRoundTrip?await options.persistRoundTrip(row):JSON.parse(JSON.stringify(row)));
  if(workflowCommitDigest(row)!==workflowCommitDigest(loaded))throw Error('SNAPSHOT_ROUNDTRIP_CHANGED');return loaded;};
 async function execute(build:(context:ToolContext)=>WorkflowOperation){
  const id=`wd-${roleId}-${++count}`,context={...identity,runId:id,attemptId:'a',deadlineAt:Date.now()+60000};
  const request=AgentRunRequestSchema.parse({inputSnapshotId:id,context,job:{type:'workflow',operation:build(context)}}),task=store.stage(request,{operationId:id,taskId:id,now:Date.now(),leaseMs:60000});
  await client.startRun(request);for await(const _event of client.events(id,{attemptId:'a',timeoutMs:65000,idleTimeoutMs:35000}))eventCount++;
  const run=await client.getRun(id,{attemptId:'a'});audit.push({request,run});
  const decision=store.prepare(task,run,Date.now()),applied=store.apply(decision,Date.now()),row=store.current().session!;
  if(request.job.type==='workflow'&&request.job.operation.action==='plan'&&row.workflow.phase==='awaiting_answer')await options.onQuestionAppliedInFixture?.(row,applied.receipt);
  return row.workflow;
 }
 try{
  const skills=roleId==='java-backend'?['spring-transactions','java-concurrency']:['async-state','javascript'];
  let s=await execute(()=>({action:'create',config:{identity,session:{sessionId,roleId,durationMinutes:20,skills:skills.map((skillId,i)=>({skillId,relevance:i?0.99:1}))},
   policy:{id:'workflow-delivery-v1',roleId,parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},goal:'完整会话呈现与文本留存验收',
   skillLabels:Object.fromEntries(skills.map(k=>[k,k])),memory,allowDraftKnowledge:true,now}}));
  const answers=roleId==='java-backend'?
   ['事务边界不包含缓存更新。我会在数据库事务中记录订单和待发送事件，提交后重试更新缓存，用唯一事件ID实现幂等，并监控积压和乱序，接受最终一致。',
    'volatile 保证写入的可见性和一定的有序性，但 count++ 是读、加、写三步，不能保证复合操作原子性。我会用 AtomicInteger 的 incrementAndGet 或锁保护共享计数。']:
   ['请求使用递增序号，只让最新请求更新结果和加载状态。新输入时取消旧请求，但仍检查序号，组件卸载后忽略回调，分别呈现加载、空结果与错误状态。',
    '闭包捕获词法环境中的变量绑定，不是创建时的值快照。异步回调执行时读取该绑定的当前值；需要快照时在创建回调前复制到新局部绑定，并区分组件每次渲染的绑定。'];
  for(let i=0;i<2;i++){
   const before=s;s=await execute(context=>({action:'plan',snapshot:before,command:{identity,expectedRevision:before.revision,context}}));
   if(s.phase!=='awaiting_answer')throw Error('EXPECTED_ISSUED_QUESTION');
   const planned=s;s=await execute(context=>({action:'answer',snapshot:planned,command:{identity,expectedRevision:planned.revision,context,
    observationId:`o${i}`,answer:{id:`a${i}`,text:answers[i]!},quality:1,evidenceMode:mode}}));
  }
  const answered=s;s=await execute(()=>({action:'finish',snapshot:answered,command:{identity,expectedRevision:answered.revision,sourceGroupId:`wd-group-${roleId}`,mode:'automatic'}}));
  const exported=await roundTrip();s=await execute(()=>({action:'restore',snapshot:exported.workflow}));const restored=await roundTrip();
  if(workflowCommitDigest(exported.workflow)!==workflowCommitDigest(restored.workflow))throw Error('RESTORE_CHANGED_TEXT');
  return{roleId,evidenceMode:mode,inputOrigin:'hand-authored-synthetic',transport:server?'tcp':'in-process',scope:'api-cas-fixture-json-roundtrip',
   formalCommitted:false,productionRestartRecovery:false,eventCount,session:s,stored:restored,audit,
   ...(own?{liveModelCalls:0}:{})};
 }finally{if(own)runtime.dispose();await server?.stop(true);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const dir=join(process.cwd(),'.cache','workflow-delivery-demo');await mkdir(dir,{recursive:true});
 for(const role of ['java-backend','web-frontend']as const){const file=join(dir,role+'.json');
  const r=await runWorkflowDeliveryDemo(role,{transport:process.argv.includes('--tcp')?'tcp':'in-process',persistRoundTrip:async row=>{
   await writeFile(file,JSON.stringify(row,null,2)+'\n');return JSON.parse(await readFile(file,'utf8'));}});
  console.log(JSON.stringify({role,phase:r.session.phase,issued:r.session.issuedQuestions.map(q=>({id:q.questionId,text:q.content?.text,delivery:q.content?.delivery?.status??'first-canonical'})),
   reportTexts:r.session.closeout?.report.assessments.map(a=>a.presentedText),snapshot:file,scope:r.scope,transport:r.transport,formalCommitted:false,liveModelCalls:0}));}
}
