import {test,expect} from 'bun:test';import {createRuntimeDiagnostics} from '../apps/agent/src/local/process-diagnostics.ts';
import {createProcessDiagnostics} from '../packages/local-agent-client/src/process-diagnostics.ts';
test('runtime diagnostic writer rejects raw payload fields and bounds its total output',()=>{
 let text='';const write=createRuntimeDiagnostics(value=>{text+=value;});
 write({stage:'startup',code:'HOST_READY',secret:'sensitive'});expect(text).toBe('');
 for(let i=0;i<2000;i++)write({stage:'rpc',code:'REQUEST_RECEIVED',method:'runtime.status'});
 expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16384);expect(text).not.toContain('secret');
 expect(()=>createRuntimeDiagnostics(()=>{throw Error('sink');})({stage:'startup',code:'HOST_READY'})).not.toThrow();
});
test('split stderr frames survive chunking, oversized/Unicode garbage is dropped, observer throws are isolated',()=>{
 const d=createProcessDiagnostics(()=>{throw Error('observer');});
 const frame=JSON.stringify({type:'runtime-diagnostic',schemaVersion:1,stage:'output',code:'OUTPUT_TIMEOUT'})+'\n';
 d.stderr(Buffer.from('x'.repeat(5000)+'\n中文私密\n'+frame.slice(0,20)));d.stderr(Buffer.from(frame.slice(20)));
 expect(d.snapshot().events.map(e=>e.code)).toEqual(['OUTPUT_TIMEOUT']);expect(JSON.stringify(d.snapshot())).not.toContain('私密');
});
