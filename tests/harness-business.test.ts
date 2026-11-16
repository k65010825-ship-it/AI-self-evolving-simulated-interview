import {test,expect} from 'bun:test';
import {createStageHooks} from '../apps/agent/src/harness/business-guards.ts';
import java from '../knowledge/java-backend/seed.json' with {type:'json'};
import {createHarnessPiSession} from '../apps/agent/src/adapters/pi/session-factory.ts';
const item=java[0]!;
function receipt(){return {callId:'t',toolName:'query_role_knowledge',status:'ok',sourceIds:item.sourceIds,durationMs:0,data:{items:[item]}};}
const scope=()=>({roleId:'java-backend' as const,skillId:item.skillId,allowDraftKnowledge:true});
test('mandatory planning post-tool guard rejects malformed, foreign-skill and unapproved draft receipts',()=>{
 const hooks=createStageHooks('planning',scope()),post=hooks[0]!.postToolUse!;
 expect(()=>post({status:'ok'})).toThrow('MODEL_OUTPUT_INVALID');
 const foreign=receipt();foreign.data.items=[{...item,skillId:'foreign'}];expect(()=>post(foreign)).toThrow('MODEL_OUTPUT_INVALID');
 expect(()=>createStageHooks('planning',{...scope(),allowDraftKnowledge:false})[0]!.postToolUse!(receipt())).toThrow('MODEL_OUTPUT_INVALID');
 expect(()=>post(receipt())).not.toThrow();
});
test('planning scope is validated and detached from later host object mutation',()=>{
 expect(()=>createStageHooks('planning')).toThrow('VALIDATION_ERROR');
 const original=scope(),hooks=createStageHooks('planning',original);original.skillId='foreign';
 expect(()=>hooks[0]!.postToolUse!(receipt())).not.toThrow();
});
test('stage output contracts cannot be replaced by arbitrary schema-valid data of another phase',()=>{
 for(const phase of ['evaluation','delivery'] as const){const stop=createStageHooks(phase,phase==='delivery'?{previousAnswerText:'事务边界'}:undefined)[0]!.stop!;
  expect(()=>stop({kind:'uncommitted-knowledge-plan'})).toThrow('MODEL_OUTPUT_INVALID');}
 const stop=createStageHooks('delivery',{previousAnswerText:'事务边界'})[0]!.stop!;
 expect(()=>stop({bridge:'你提到了事务边界。',excerpt:'事务边界'})).not.toThrow();
 expect(()=>stop({bridge:'你提到了其他内容。',excerpt:'其他内容'})).toThrow('MODEL_OUTPUT_INVALID');
});
test('invalid hook configuration is rejected before the SDK touches runtime allocation',async()=>{
 let touched=0;const runtime=new Proxy({},{get(){touched++;throw Error('must not allocate');}});
 await expect(createHarnessPiSession({phase:'evaluation',cwd:process.cwd(),modelRuntime:runtime as never,model:{} as never,systemPrompt:'policy',
  signal:new AbortController().signal,hooks:[{id:'INVALID ID'}]})).rejects.toThrow('VALIDATION_ERROR');
 expect(touched).toBe(0);
});

import {createInterviewState} from '../apps/agent/src/planning/interview-state.ts';
import {selectNextQuestion} from '../apps/agent/src/planning/select-question.ts';
test('planning Stop binds the selected question and receipt set to actual PostToolUse observations',()=>{
 const now=Date.now(),state=createInterviewState({sessionId:'s',roleId:'java-backend',durationMinutes:20,skills:[{skillId:item.skillId,relevance:1}]},now);
 const selection=selectNextQuestion({state,now,knowledge:[item],askedQuestionIds:[]},{allowDraftKnowledge:true});
 expect(selection.status).toBe('selected');
 const output={kind:'uncommitted-knowledge-plan',selection,receipts:[receipt()],modelMessages:2};
 const hook=createStageHooks('planning',scope())[0]!;
 expect(()=>hook.stop!(output)).toThrow('MODEL_OUTPUT_INVALID');hook.postToolUse!(receipt());expect(()=>hook.stop!(output)).not.toThrow();
 if(selection.status!=='selected')throw Error('fixture');
 expect(()=>hook.stop!({...output,selection:{...selection,question:{...selection.question,text:'invented question'}}})).toThrow('MODEL_OUTPUT_INVALID');
 expect(()=>hook.stop!({...output,receipts:[]})).toThrow('MODEL_OUTPUT_INVALID');
});
test('custom host hooks cannot replace mandatory business guard IDs',async()=>{
 let touched=0;const runtime=new Proxy({},{get(){touched++;throw Error('must not allocate');}});
 await expect(createHarnessPiSession({phase:'evaluation',cwd:process.cwd(),modelRuntime:runtime as never,model:{} as never,systemPrompt:'policy',
  signal:new AbortController().signal,hooks:[{id:'business-evaluation',stop:()=>{}}]})).rejects.toThrow('VALIDATION_ERROR');
 expect(touched).toBe(0);
});
test('non-function hook callbacks are invalid configuration rather than delayed runtime failures',async()=>{
 let touched=0;const runtime=new Proxy({},{get(){touched++;throw Error('must not allocate');}});
 await expect(createHarnessPiSession({phase:'evaluation',cwd:process.cwd(),modelRuntime:runtime as never,model:{} as never,systemPrompt:'policy',
  signal:new AbortController().signal,hooks:[{id:'host-check',stop:'bad' as never}]})).rejects.toThrow('VALIDATION_ERROR');
 expect(touched).toBe(0);
});
