import {test,expect} from 'bun:test';
import {createCompletionGate} from '../apps/agent/src/harness/completion-gate.ts';
import {getHarnessProfile,createSkillCatalog} from '../apps/agent/src/harness/profiles.ts';
test('completion requires settlement, no failed tool, and successful host validation',()=>{
 const gate=createCompletionGate([]);expect(()=>gate.accept(()=>42)).toThrow('MODEL_OUTPUT_INVALID');
 gate.observe({type:'agent_settled',aborted:false});expect(()=>gate.accept(()=>42)).toThrow('MODEL_OUTPUT_INVALID');
});
test('tool failure is sticky even when assistant later claims success',()=>{
 const gate=createCompletionGate(['query_role_knowledge']);
 gate.observe({type:'tool_execution_end',toolCallId:'t',toolName:'query_role_knowledge',result:{content:[],details:{status:'error'}},isError:true});
 gate.observe({type:'agent_settled',aborted:false});expect(()=>gate.accept(()=>42)).toThrow('MODEL_OUTPUT_INVALID');
});
test('phase profiles expose only their declared tools and four extension categories',()=>{
 expect(getHarnessProfile('planning').tools).toEqual(['query_role_knowledge']);
 expect(getHarnessProfile('evaluation').tools).toEqual([]);expect(getHarnessProfile('delivery').tools).toEqual([]);
 expect(new Set(getHarnessProfile('planning').extensions.map(e=>e.kind))).toEqual(new Set(['skill','tool-source','hook','sidecar']));
});
test('skill discovery is metadata-only; a rejected loader is retryable and cached success cannot mutate catalog',async()=>{
 let calls=0;const catalog=createSkillCatalog({evaluation:async()=>{calls++;if(calls===1)throw Error('transient');return 'safe';}});
 expect(catalog.list().length).toBe(3);expect(calls).toBe(0);
 await expect(catalog.load('evaluation')).rejects.toThrow('transient');expect(await catalog.load('evaluation')).toBe('safe');
 expect(await catalog.load('evaluation')).toBe('safe');expect(calls).toBe(2);
});

import type {AssistantMessage} from '@earendil-works/pi-ai';
function stopped(text='done'):AssistantMessage{return {role:'assistant',content:[{type:'text',text}],api:'openai-completions',provider:'fixture',model:'fixture',stopReason:'stop',timestamp:1,
 usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};}
test('valid final output crosses only after validator; gate detaches mutable child result',()=>{
 const gate=createCompletionGate([]);gate.observe({type:'message_end',message:stopped()});gate.observe({type:'agent_settled',aborted:false});
 expect(()=>gate.accept(()=>{throw Error('schema rejected');})).toThrow('schema rejected');
 const child={answer:{score:1}};const accepted=gate.accept(()=>child);child.answer.score=9;expect(accepted.answer.score).toBe(1);
});
test('host Stop hook failure blocks a schema-valid result and cannot silently succeed',()=>{
 const gate=createCompletionGate([],undefined,[{id:'quality-gate',stop:()=>{throw Error('rejected');}}]);
 gate.observe({type:'message_end',message:stopped()});gate.observe({type:'agent_settled',aborted:false});
 expect(()=>gate.accept(()=>({valid:true}))).toThrow('MODEL_OUTPUT_INVALID');
});
test('host PostToolUse hook failure stays denied after a successful later message',()=>{
 const gate=createCompletionGate(['query_role_knowledge'],undefined,[{id:'receipt-gate',postToolUse:()=>{throw Error('bad receipt');}}]);
 gate.observe({type:'tool_execution_start',toolCallId:'t',toolName:'query_role_knowledge',args:{}});
 gate.observe({type:'tool_execution_end',toolCallId:'t',toolName:'query_role_knowledge',result:{content:[],details:{}},isError:false});
 gate.observe({type:'message_end',message:stopped()});gate.observe({type:'agent_settled',aborted:false});expect(()=>gate.accept(()=>true)).toThrow('MODEL_OUTPUT_INVALID');
});
