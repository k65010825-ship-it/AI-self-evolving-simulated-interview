import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {removeAccountingTemp} from './helpers/accounting-temp.ts';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openSessionAccounting} from '../apps/agent/src/accounting/session-ledger.ts';
const dirs:string[]=[];
afterEach(()=>{for(const d of dirs.splice(0))removeAccountingTemp(d);});
const policy={sessionId:'session',userId:'student',roleId:'java-backend',currency:'CNY',maxCostMicros:100,maxCalls:4,maxConcurrent:2,deadlineAt:10000};
const pricing={source:'test-declared-ceiling',version:'v1',unit:'request' as const};
const reserve=(attemptId:string,kind:'llm'|'asr'|'tts'='llm',cost=30)=>({sessionId:'session',userId:'student',roleId:'java-backend',operationId:`op-${attemptId}`,attemptId,kind,reservedCostMicros:cost,pricing});
const bill=(attemptId:string,expectedVersion:number,actualCostMicros=10)=>({sessionId:'session',attemptId,expectedVersion,reconciliationId:`bill-${attemptId}`,actualCostMicros,evidence:{kind:'host-imported-bill' as const,reference:'local:invoice-line',sha256:'a'.repeat(64)}});
function setup(){const d=mkdtempSync(join(tmpdir(),'session-ledger-'));dirs.push(d);const path=join(d,'ledger.sqlite');const ledger=openSessionAccounting(path,{now:()=>100});ledger.ensureSession(policy);return{ledger,path};}
test('separate SQLite connections share ASR/LLM/TTS holds, call counts and concurrency',()=>{
 const {ledger:a,path}=setup(),b=openSessionAccounting(path,{now:()=>100});
 try{a.reserve(reserve('a','asr'));b.reserve(reserve('b','llm'));expect(()=>a.reserve(reserve('c','tts'))).toThrow('SESSION_CONCURRENCY_EXCEEDED');
 a.release('session','a');b.reserve(reserve('c','tts'));expect(a.snapshot('session').totals).toMatchObject({callsConsumed:3,activeSlots:2,heldCostMicros:60});
 expect(()=>b.reserve({...reserve('d'),userId:'other'})).toThrow('SESSION_FORBIDDEN');}finally{b.close();a.close();}
});
test('unknown survives true close/reopen and prevents automatic operation replay',()=>{
 const {ledger,path}=setup();ledger.reserve(reserve('a'));ledger.dispatch('session','a');ledger.close();
 const reopened=openSessionAccounting(path,{now:()=>100});try{reopened.recoverExpired(10001);expect(reopened.snapshot('session').entries[0]?.status).toBe('unknown');
 expect(reopened.snapshot('session').totals.heldCostMicros).toBe(30);
 expect(()=>reopened.reserve({...reserve('retry'),operationId:'op-a'})).toThrow('SESSION_REPLAY_BLOCKED');}finally{reopened.close();}
});
test('reconciliation is CAS protected, idempotent, conflict detecting and never vendor verified',()=>{
 const {ledger}=setup();try{ledger.reserve(reserve('a'));ledger.dispatch('session','a');ledger.markUnknown('session','a');const version=ledger.snapshot('session').version;
 expect(()=>ledger.reconcile(bill('a',version-1))).toThrow('SESSION_VERSION_CONFLICT');const receipt=ledger.reconcile(bill('a',version));
 expect(receipt.authority).toBe('host-supplied-not-vendor-verified');expect(ledger.reconcile(bill('a',version))).toEqual(receipt);
 expect(()=>ledger.reconcile({...bill('a',version),actualCostMicros:11})).toThrow('SESSION_RECONCILIATION_CONFLICT');
 expect(ledger.snapshot('session').totals).toMatchObject({usedCostMicros:10,heldCostMicros:0,activeSlots:0});}finally{ledger.close();}
});
test('observed overrun is recorded in full and locks subsequent admission',()=>{
 const {ledger}=setup();try{ledger.reserve(reserve('a'));ledger.dispatch('session','a');ledger.reconcile(bill('a',ledger.snapshot('session').version,150));
 expect(ledger.snapshot('session')).toMatchObject({locked:true,totals:{usedCostMicros:150}});expect(()=>ledger.reserve(reserve('b'))).toThrow('SESSION_BUDGET_LOCKED');}finally{ledger.close();}
});
test('admission and checkpoints reject duplicate attempt, stale deadline and zero unknown settlement',()=>{
 const {ledger}=setup();try{ledger.reserve(reserve('a'));expect(()=>ledger.reserve(reserve('a'))).toThrow('SESSION_ATTEMPT_REUSED');
 expect(()=>ledger.reconcile(bill('a',1))).toThrow('SESSION_STATE_CONFLICT');ledger.dispatch('session','a');ledger.markUnknown('session','a');
 expect(()=>ledger.reconcile({...bill('a',ledger.snapshot('session').version,0),evidence:{...bill('a',1).evidence,reference:''}})).toThrow();
 expect(()=>ledger.ensureSession({...policy,maxCalls:99})).toThrow('SESSION_POLICY_CONFLICT');}finally{ledger.close();}
});
test('observed HTTP response keeps unpaid cost but frees concurrency',()=>{
 const {ledger}=setup();try{ledger.reserve(reserve('a'));ledger.dispatch('session','a');ledger.completeResponse('session','a');
 expect(ledger.snapshot('session').totals).toMatchObject({heldCostMicros:30,activeSlots:0});
 ledger.reserve(reserve('b','tts'));ledger.dispatch('session','b');ledger.completeResponse('session','b');
 ledger.reserve(reserve('c','asr'));expect(ledger.snapshot('session').totals.heldCostMicros).toBe(90);
 expect(()=>ledger.reserve(reserve('d'))).toThrow('SESSION_COST_BUDGET_EXCEEDED');
 ledger.reconcile(bill('a',ledger.snapshot('session').version,15));expect(ledger.snapshot('session').totals.usedCostMicros).toBe(15);
 }finally{ledger.close();}
});
test('concurrent independent OS processes cannot oversubscribe one SQLite session',async()=>{
 const {ledger,path}=setup();try{const moduleUrl=pathToFileURL(join(process.cwd(),'apps/agent/src/accounting/session-ledger.ts')).href;
 const children=Array.from({length:5},(_,i)=>{const source=`import {openSessionAccounting} from ${JSON.stringify(moduleUrl)};const l=openSessionAccounting(${JSON.stringify(path)},{now:()=>100});try{l.reserve(${JSON.stringify(reserve(`p${i}`))});console.log('admitted')}catch(e){console.log(e.message)}finally{l.close()}`;
 return Bun.spawn([process.execPath,'-e',source],{stdout:'pipe',stderr:'pipe'});});
 const outputs=await Promise.all(children.map(async child=>{const out=await new Response(child.stdout).text();const err=await new Response(child.stderr).text();expect(await child.exited).toBe(0);expect(err).toBe('');return out.trim();}));
 expect(outputs.filter(v=>v==='admitted')).toHaveLength(2);expect(outputs.filter(v=>v==='SESSION_CONCURRENCY_EXCEEDED')).toHaveLength(3);
 expect(ledger.snapshot('session').totals).toMatchObject({callsConsumed:2,heldCostMicros:60,activeSlots:2});
 }finally{ledger.close();}
});
