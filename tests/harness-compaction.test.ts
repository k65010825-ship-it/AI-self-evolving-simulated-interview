import {test,expect} from 'bun:test';
import {prepareWireContext} from '../apps/agent/src/context/wire-context.ts';
const payload=()=>({messages:[{role:'system',content:'immutable'},{role:'user',content:JSON.stringify({roleId:'java-backend',goal:'g',plan:{},skills:[],policy:{},memory:[{id:'a',text:'x'.repeat(400)},{id:'b',text:'y'.repeat(400)}]})}]});
const policy={enabled:true,windowTokens:2000,triggerRatio:.4};
test('host compactor can select optional memory but cannot synthesize or change evidence',()=>{
 const raw=payload(),before=JSON.stringify(raw);
 const out=prepareWireContext(raw,policy,200,false,[{id:'keep-first',compactMemory:memory=>memory.slice(0,1)}]);
 expect(JSON.parse(String(out.payload.messages[1]?.content)).memory).toHaveLength(1);expect(JSON.stringify(raw)).toBe(before);
 expect(out.stages.map(s=>s.id)).toContain('keep-first');
 expect(()=>prepareWireContext(raw,policy,200,true,[{id:'inject',compactMemory:()=>[{forged:'grade'}]}])).toThrow('VALIDATION_ERROR');
});
test('compaction never touches required scoring payloads or orphaned tool pairs',()=>{
 const raw={messages:[{role:'user',content:JSON.stringify({rubric:{id:'r'},answer:'original',memory:['private']})},{role:'tool',tool_call_id:'t',content:'receipt'}]};
 const result=prepareWireContext(raw,{enabled:false,windowTokens:10000,triggerRatio:.8},100,true);
 expect(result.payload).toEqual(raw);expect(result.stages).toEqual([]);
});
