import {test,expect} from 'bun:test';import {prepareWireContext,estimateWireTokens} from '../apps/agent/src/context/wire-context.ts';
for(const roleId of ['java-backend','web-frontend'])test(`${roleId}: auto compaction retains an ordered memory prefix while reactive compaction preserves all required payloads`,()=>{
 const memory=Array.from({length:4},(_,i)=>({questionId:'q'+i,rubricVersion:'v1',evidenceMode:'offline-fixture',text:'🦊'.repeat(120)}));
 const user={roleId,goal:'goal',plan:{action:'deepen',skillId:'s'},skills:[{skillId:'s',mastery:.4,confidence:.2}],policy:{maxTurns:6},memory};
 const tail=[{role:'assistant',tool_calls:[{id:'call',type:'function',function:{name:'query_role_knowledge',arguments:'{}'}}]},{role:'tool',tool_call_id:'call',content:'required receipt'}];
 const payload={messages:[{role:'system',content:'required policy'},{role:'user',content:JSON.stringify(user)},...tail],tools:[{type:'function',function:{name:'query_role_knowledge'}}]},before=structuredClone(payload);
 const half={...payload,messages:[payload.messages[0]!,{role:'user',content:JSON.stringify({...user,memory:memory.slice(0,2)})},...tail]};
 const output=100,windowTokens=estimateWireTokens(half)+output+10,policy={enabled:true,windowTokens,triggerRatio:1};
 const auto=prepareWireContext(payload,policy,output);
 expect(JSON.parse(String(auto.payload.messages[1]!.content)).memory).toEqual(memory.slice(0,2));
 expect(auto.stages.map(s=>s.id)).toContain('halve-optional-memory');expect(auto.stages.map(s=>s.id)).not.toContain('drop-optional-memory');
 const reactive=prepareWireContext(payload,{...policy,enabled:false},output,true),parsed=JSON.parse(String(reactive.payload.messages[1]!.content));
 expect(parsed).toEqual({...user,memory:[]});expect(reactive.payload.messages.slice(2)).toEqual(tail);expect(reactive.payload.tools).toEqual(payload.tools);expect(payload).toEqual(before);
 const scoring={messages:[{role:'user',content:JSON.stringify({rubric:{required:'full'},answer:'不可删减的原答🦊',memory})},...tail]};
 expect(prepareWireContext(scoring,{enabled:false,windowTokens:1,triggerRatio:1},0,true).payload).toEqual(scoring);
});
