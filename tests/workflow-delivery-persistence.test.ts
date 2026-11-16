import{test,expect}from'bun:test';
import{mkdir,mkdtemp,writeFile,readFile,unlink,rmdir}from'node:fs/promises';
import{resolve,join}from'node:path';
import{runWorkflowDeliveryDemo}from'../scripts/demo-workflow-delivery.ts';
import{createRunManager}from'../apps/agent/src/runtime/run-manager.ts';
import{createWorkflowFixture}from'../experiments/session/fixture.ts';
import{createWorkflowCommitTicket,prepareWorkflowCommit}from'../packages/agent-client/src/workflow-commit.ts';
import{WorkflowSchema}from'../packages/contracts/src/session-workflow.ts';
import{planInterviewQuestion}from'../apps/agent/src/orchestration/session-workflow.ts';
import{AgentRunRequestSchema}from'../packages/contracts/src/agent-run.ts';

test('both roles export actual question text to JSON, restore it via HTTP/SSE and prepare API-owned CAS writes',async()=>{
 const root=resolve('.cache/workflow-delivery-tests');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'run-')),files:string[]=[];
 try{for(const role of ['java-backend','web-frontend']as const){
  const f=await createWorkflowFixture(role,{delivery:true}),runtime=createRunManager({evaluateForRole:()=>async(request,signal)=>{
   expect(JSON.stringify(request)).not.toContain('presentedText');expect(JSON.stringify(request)).not.toContain('我们继续往下看');return f.evaluate(request,signal);},
   planForRole:()=>f.plan,deliverForRole:()=>f.deliver!});const path=join(dir,role+'.json');files.push(path);
  try{const r=await runWorkflowDeliveryDemo(role,{runtime,evidenceMode:'offline-fixture',persistRoundTrip:async row=>{await writeFile(path,JSON.stringify(row));return JSON.parse(await readFile(path,'utf8'));}});
   const stored=JSON.parse(await readFile(path,'utf8'));expect(stored).toEqual(r.stored);expect(r.session.phase).toBe('completed');expect(r.eventCount).toBeGreaterThan(7);
   expect(r.session.issuedQuestions[1]!.content!.delivery?.status).toBe('generated');
   expect(r.session.turns[1]!.input.presentedText).toBe(stored.workflow.issuedQuestions[1].content.text);
   expect(r.session.closeout!.report.assessments[1]!.presentedText).toBe(stored.workflow.issuedQuestions[1].content.text);
   expect(f.stats.planning.providerCalls).toBe(4);expect(f.stats.scoring.providerCalls).toBe(2);expect(f.stats.delivery!.providerCalls).toBe(1);
   expect(r.formalCommitted).toBe(false);expect(r.productionRestartRecovery).toBe(false);
  }finally{runtime.dispose();}
 }}finally{for(const path of files)await unlink(path).catch(()=>{});await rmdir(dir);}
},20000);
test('workflow timestamps issuance after generation and keeps a cancelled raw presenter occupied',async()=>{
 const d=await runWorkflowDeliveryDemo(),answered=d.audit.filter(a=>a.request.job.type==='workflow'&&a.request.job.operation.action==='answer')[0]!.run.result;
 if(answered?.kind!=='uncommitted-workflow-result')throw Error('workflow');const s=answered.snapshot,f=await createWorkflowFixture(),identity=s.identity;
 let at=Date.now();const before=at,context={...identity,runId:'after-render',attemptId:'a',deadlineAt:at+60000};
 const planned=await planInterviewQuestion(s,{identity,expectedRevision:s.revision,context},{plan:f.plan,now:()=>at,deliver:async()=>{
  at+=100;return{bridge:'你刚才提到事务边界，我们继续往下看。',excerpt:'事务边界'};}});
 expect(planned.currentIssuedAt).toBe(before+100);expect(planned.issuedQuestions.at(-1)?.issuedAt).toBe(before+100);
 let entered!:()=>void,release!:(v:unknown)=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const runtime=createRunManager({evaluateForRole:()=>f.evaluate,planForRole:()=>f.plan,deliverForRole:()=>async()=>{entered();return new Promise(resolve=>{release=resolve;});}});
 try{const ctx={...identity,runId:'workflow-cancel-raw',attemptId:'a',deadlineAt:Date.now()+60000};
  const request=AgentRunRequestSchema.parse({inputSnapshotId:'workflow-cancel-raw',context:ctx,job:{type:'workflow',operation:{action:'plan',snapshot:s,command:{identity,expectedRevision:s.revision,context:ctx}}}});
  runtime.start(request);await started;runtime.cancel(ctx.runId,ctx.attemptId);await runtime.wait(ctx.runId);
  expect(runtime.snapshot(ctx.runId).status).toBe('cancelled');expect(runtime.diagnostics().inFlightDependencies).toBe(1);
  release({bridge:'你提到事务边界，我们继续。',excerpt:'事务边界'});await new Promise(resolve=>setTimeout(resolve,1));expect(runtime.diagnostics().inFlightDependencies).toBe(0);
  const events=[];for await(const e of runtime.events(ctx.runId))events.push(e);expect(events.some(e=>e.type==='question.completed')).toBe(false);
 }finally{runtime.dispose();}
},20000);

test('API commit validation rejects schema-consistent history rewrites or downgrade to unknown legacy text',async()=>{
 const r=await runWorkflowDeliveryDemo(),item=r.audit.filter(a=>a.request.job.type==='workflow'&&a.request.job.operation.action==='answer').at(-1)!;
 const request=item.request;if(request.job.type!=='workflow'||request.job.operation.action!=='answer')throw Error('answer');
 const op=request.job.operation,identity=op.snapshot.identity,now=Date.now();
 const ticket=createWorkflowCommitTicket({identity,request,operationId:'test-history',taskId:'test-history',leaseVersion:1,expectedStorageVersion:3,
  expectedMemoryVersion:0,issuedAt:Date.parse(item.run.createdAt),leaseUntil:request.context.deadlineAt});
 for(const downgrade of [false,true]){
  const bad=structuredClone(item.run);if(bad.result?.kind!=='uncommitted-workflow-result')throw Error('workflow');const s=bad.result.snapshot;
  if(downgrade){delete s.issuedQuestions[1]!.content;delete s.turns[1]!.input.presentedText;}
  else{const content=s.issuedQuestions[1]!.content!,d=content.delivery!;d.bridge=`你提到“${d.excerpt}”，我们接着换个角度。`;d.text=d.bridge+'\n'+d.question.text;content.text=d.text;s.turns[1]!.input.presentedText=d.text;}
  expect(WorkflowSchema.safeParse(s).success).toBe(true);
  expect(()=>prepareWorkflowCommit({ticket,request,run:bad,current:{session:{storageVersion:3,workflow:op.snapshot},memory:op.snapshot.baseMemory},receipt:null,now})).toThrow('COMMIT_TRANSITION_INVALID');
 }
},20000);
