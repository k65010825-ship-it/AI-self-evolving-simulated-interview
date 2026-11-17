import {test,expect} from 'bun:test';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {bindLocalProcess} from '../packages/local-agent-client/src/connection.ts';
function fixture(timeoutMs=1000){
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),pid:123,kill:(_signal?:string)=>true});
 const sent:{id:string;method:string}[]=[];child.stdin.on('data',data=>{sent.push(JSON.parse(data.toString()));});
 const client=bindLocalProcess(child as unknown as ChildProcessWithoutNullStreams,{timeoutMs});
 const reply=(index:number,result:unknown)=>child.stdout.write(JSON.stringify({protocolVersion:1,type:'response',id:sent[index]!.id,ok:true,result})+'\n');
 return{child,client,sent,reply,end:()=>{child.emit('exit',0,null);child.emit('close',0,null);}};
}
test('exit does not discard a valid final response while stdout is still open',async()=>{
 const f=fixture();let outcome='pending';const request=f.client.request('runtime.status',{}).then(v=>{outcome='resolved';return v;},e=>{outcome=(e as Error).message;return null;});
 try{f.child.emit('exit',0,null);await Promise.resolve();expect(outcome).toBe('pending');
  f.reply(0,{ready:true});f.child.emit('close',0,null);expect(await request).toEqual({ready:true});
 }finally{f.end();await request;}
});
test('one request timeout terminally rejects all pending requests even if child exit is delayed',async()=>{
 const f=fixture(20);let second='pending';
 const a=f.client.request('runtime.status',{}).catch(e=>(e as Error).message);
 const b=f.client.request('roles.list',{}).catch(e=>{second=(e as Error).message;return second;});
 try{expect(await a).toBe('LOCAL_REQUEST_TIMEOUT');expect(second).toBe('LOCAL_REQUEST_TIMEOUT');
  const late=await f.client.request('roles.list',{}).catch(e=>(e as Error).message);expect(late).toBe('LOCAL_PROCESS_CLOSED');
 }finally{f.end();await b;}
});
test('EOF with a partial response is diagnosed as protocol truncation, not a successful exit',async()=>{
 const f=fixture();const result=f.client.request('runtime.status',{}).catch(e=>(e as Error).message);
 f.child.stdout.write('{"protocolVersion":1');f.end();expect(await result).toBe('LOCAL_PROTOCOL_INVALID');
});
test('diagnostics retain bounded validated stages, never raw stderr, credentials or answers',()=>{
 const f=fixture();
 f.child.stderr.write('secret-key-and-answer\n'+JSON.stringify({type:'runtime-diagnostic',schemaVersion:1,stage:'startup',code:'HOST_READY'})+'\n');
 f.child.stderr.write(JSON.stringify({type:'runtime-diagnostic',schemaVersion:1,stage:'startup',code:'HOST_READY',secret:'must-not-appear'})+'\n');
 for(let i=0;i<100;i++)f.child.stderr.write(JSON.stringify({type:'runtime-diagnostic',schemaVersion:1,stage:'rpc',code:'REQUEST_RECEIVED',method:'runtime.status'})+'\n');
 const d=f.client.diagnostics();expect(d.events.length).toBeLessThanOrEqual(64);expect(d.discarded).toBeGreaterThan(0);
 expect(JSON.stringify(d)).not.toContain('secret');expect(JSON.stringify(d)).not.toContain('must-not-appear');
 const copy=f.client.diagnostics();copy.events.length=0;expect(f.client.diagnostics().events.length).toBeGreaterThan(0);f.end();
});
test('pipe faults terminate pending work and late stdout cannot revive the connection',async()=>{
 const f=fixture(),result=f.client.request('runtime.status',{}).catch(e=>(e as Error).message);
 f.child.stdout.emit('error',Error('private details'));expect(await result).toBe('LOCAL_PIPE_CLOSED');
 f.reply(0,{ready:true});expect(await f.client.request('runtime.status',{}).catch(e=>(e as Error).message)).toBe('LOCAL_PROCESS_CLOSED');
 expect(JSON.stringify(f.client.diagnostics())).not.toContain('private details');f.end();
});
test('concurrent close callers share the same bounded failure when a killed child never closes',async()=>{
 const f=fixture(10);await f.client.request('runtime.status',{}).catch(()=>{});let second='pending';
 const a=f.client.close().catch(e=>(e as Error).message),b=f.client.close().then(()=>{second='resolved';},e=>{second=(e as Error).message;});
 try{expect(await a).toBe('LOCAL_SHUTDOWN_INCOMPLETE');await Promise.resolve();expect(second).toBe('LOCAL_SHUTDOWN_INCOMPLETE');}
 finally{f.end();await b;}
});
