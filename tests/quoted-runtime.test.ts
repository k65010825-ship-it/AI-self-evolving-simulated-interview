import {test,expect} from 'bun:test';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';
import {createDurableLiveRunManager} from '../apps/agent/src/runtime/durable-runtime.ts';
import example from '../apps/agent/src/model-access/qianwen.example.json' with {type:'json'};
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
const response=(wire:unknown)=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(wire)},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:300,total_tokens:400}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});

test('quoted mode passes real SDK and injected HTTP, accounts once and replays a durable zero without credentials',async()=>{
 await mkdir('.cache/quoted-spans',{recursive:true});
 for(const role of ['java-backend','web-frontend']as const){const f=quotedFixture(role,0),dir=await mkdtemp('.cache/quoted-spans/run-'),path=join(dir,'agent.sqlite');let calls=0;
  const config={...example,planning:'deterministic',evidenceGrounding:'quoted-spans',authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:1}};
  const req={inputSnapshotId:'quote-'+role,context:f.input.context,job:{type:'turn',input:f.input,knowledge:[],askedQuestionIds:[],allowDraftKnowledge:true}};
  const runtime=createDurableLiveRunManager(config,{readCredential:()=> 'synthetic-fixture-only',fetch:async()=>{calls++;return response(f.wire);}},{path,ownerId:'quote-owner'});
  let snapshot:ReturnType<typeof runtime.snapshot>,accounting:ReturnType<typeof runtime.modelAccounting>;
  try{runtime.start(req);await runtime.wait(req.context.runId);snapshot=runtime.snapshot(req.context.runId);accounting=runtime.modelAccounting();
   expect(snapshot.status,JSON.stringify({error:snapshot.error,diagnostics:runtime.evaluationDiagnostics()})).toBe('completed');expect(snapshot.result?.kind).toBe('uncommitted-turn-result');
   if(snapshot.result?.kind==='uncommitted-turn-result')expect(snapshot.result.proposal.evaluation.normalizedScore).toBe(0);
   expect(calls).toBe(1);expect(accounting[0]!.totals.usedTokens).toBe(400);
   expect(runtime.evaluationDiagnostics()[0]!.events).toContainEqual({version:1,stage:'evidence',outcome:'repaired',reason:'verification-quotes-grounded'});
  }finally{await runtime.shutdown({graceMs:0,cancelWaitMs:1000});runtime.close();}
  const replay=createDurableLiveRunManager(config,{readCredential:()=>{throw Error('must not read');},fetch:async()=>{throw Error('must not send');}},{path,ownerId:'quote-replay'});
  try{replay.start(req);await replay.wait(req.context.runId);expect(replay.snapshot(req.context.runId)).toEqual(snapshot!);expect(replay.modelAccounting()).toEqual(accounting!);expect(calls).toBe(1);}
  finally{await replay.shutdown({graceMs:0,cancelWaitMs:1000});replay.close();}
 }
},30000);

test('absent quote is a bounded evidence failure, settles injected usage and cannot trigger model JSON repair',async()=>{
 const f=quotedFixture();f.wire.criterionScores[0]!.verificationBinding.action.excerpt='private-absent-quote';let calls=0;
 const dir=await mkdtemp('.cache/quoted-spans/run-'),config={...example,planning:'deterministic',evidenceGrounding:'quoted-spans',recovery:{maxModelRepairs:1},authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:1}};
 const runtime=createDurableLiveRunManager(config,{readCredential:()=> 'synthetic-fixture-only',fetch:async()=>{calls++;return response(f.wire);}},{path:join(dir,'agent.sqlite'),ownerId:'quote-invalid'});
 try{runtime.start({inputSnapshotId:'bad-quote',context:f.input.context,job:{type:'turn',input:f.input,knowledge:[],askedQuestionIds:[],allowDraftKnowledge:true}});await runtime.wait(f.input.context.runId);
  expect(runtime.snapshot(f.input.context.runId).status).toBe('failed');expect(calls).toBe(1);expect(runtime.modelAccounting()[0]!.totals.usedTokens).toBe(400);
   expect(runtime.evaluationDiagnostics()[0]!.events).toContainEqual({version:1,stage:'schema',outcome:'accepted',reason:'valid'});
   expect(runtime.evaluationDiagnostics()[0]!.events).toContainEqual({version:1,stage:'evidence',outcome:'rejected',reason:'binding-quote-absent',quoteIssue:{part:'action',matches:'none'}});
  expect(JSON.stringify(runtime.evaluationDiagnostics())).not.toContain('private-absent');
 }finally{await runtime.shutdown({graceMs:0,cancelWaitMs:1000});runtime.close();}
},30000);

test('cancelled quote-mode SDK work cannot publish a late score or accepted diagnostic',async()=>{
 const f=quotedFixture(),controller=new AbortController(),events:unknown[]=[];let entered!:()=>void,release!:(r:{text:string})=>void;
 const started=new Promise<void>(r=>{entered=r;}),sdk=await createEvaluationFixture(()=>{entered();return new Promise(r=>{release=r;});});
 const work=evaluateTurn(f.input,{signal:controller.signal,evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:'quoted-spans',onDiagnostic:e=>events.push(e)})});
 await started;controller.abort();await expect(work).rejects.toThrow('RUN_CANCELLED');const before=structuredClone(events);release({text:JSON.stringify(f.wire)});await new Promise(r=>setTimeout(r,5));expect(events).toEqual(before);expect(sdk.stats.providerCalls).toBe(1);
});
