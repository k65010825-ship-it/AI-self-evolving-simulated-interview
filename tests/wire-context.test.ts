import{test,expect}from'bun:test';
import{prepareWireContext}from'../apps/agent/src/context/wire-context.ts';
test('wire preprocessing protects scoring inputs and tool pairs; auto compaction trims only optional planning memory',()=>{
 const user={roleId:'java-backend',goal:'goal',plan:{action:'probe',skillId:'java'},skills:[{skillId:'java',mastery:.4}],policy:{},memory:[{text:'x'.repeat(2000)}]};
 const messages=[{role:'system',content:'policy'},{role:'user',content:JSON.stringify(user)},{role:'assistant',tool_calls:[{id:'t',type:'function',function:{name:'query_role_knowledge',arguments:'{}'}}]},{role:'tool',tool_call_id:'t',content:'trusted receipt'}];
 const p=prepareWireContext({messages,tools:[{type:'function',function:{name:'query_role_knowledge'}}]}, {enabled:true,windowTokens:5000,triggerRatio:.3},500,false);
 expect(p.compacted).toBe(true);expect(JSON.parse(String(p.payload.messages[1]!.content)).memory).toEqual([]);expect(p.payload.messages.slice(2)).toEqual(messages.slice(2));expect(messages[1]!.content).toContain('xxxx');
 const scoring={messages:[{role:'system',content:'policy'},{role:'user',content:JSON.stringify({rubric:{required:'anchor'},interview:{answer:{text:'x'.repeat(2000)},memory:[]}})}]};
 const s=prepareWireContext(scoring,{enabled:true,windowTokens:5000,triggerRatio:.3},500,false);expect(s.payload).toEqual(scoring);expect(s.compacted).toBe(false);
 expect(()=>prepareWireContext(scoring,{enabled:true,windowTokens:1000,triggerRatio:.8},500,false)).toThrow('CONTEXT_BUDGET_EXCEEDED');
 const reactive=prepareWireContext({messages},{enabled:false,windowTokens:5000,triggerRatio:.8},500,true);expect(reactive.compacted).toBe(true);
});
