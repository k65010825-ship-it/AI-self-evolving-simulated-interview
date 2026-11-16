import {test,expect} from 'bun:test';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {removeAccountingTemp} from './helpers/accounting-temp.ts';
import {openSessionAccounting} from '../apps/agent/src/accounting/session-ledger.ts';
import {createSessionCheckpointAdapter} from '../apps/agent/src/accounting/checkpoint-adapter.ts';
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import {createModelBudgetGate} from '../apps/agent/src/model-access/budget.ts';
test('ASR checkpoints reserve each HTTP attempt before dispatch; response frees only slot',()=>{
 const dir=mkdtempSync(join(tmpdir(),'session-adapter-')),ledger=openSessionAccounting(join(dir,'db.sqlite'));
 try{const context=makeSpeechFixture().input.context;ledger.ensureSession({sessionId:'s',userId:context.userId,roleId:context.roleId,currency:'CNY',maxCostMicros:100,maxCalls:3,maxConcurrent:1,deadlineAt:context.deadlineAt});
 const adapter=createSessionCheckpointAdapter({ledger,binding:{sessionId:'s',userId:context.userId,roleId:context.roleId,runId:context.runId},
  pricing:{source:'synthetic-config-per-call-ceiling',version:'1',unit:'request'}});
 const checkpoint={version:1,context,accounting:'in-memory-host-declared-cost-holds-not-vendor-billing',vendorBillingVerified:false,blocked:false,callsConsumed:1,audioMsConsumed:6000,heldCostMicros:30,
  entries:[{callId:'asr-1',audioMs:6000,reservedCostMicros:30,status:'dispatched'}]};
 adapter.asr(checkpoint);expect(ledger.snapshot('s').totals.activeSlots).toBe(1);
 adapter.asr({...checkpoint,entries:[{...checkpoint.entries[0],status:'responded'}]});
 expect(ledger.snapshot('s').totals).toMatchObject({heldCostMicros:30,activeSlots:0});
 adapter.asr({...checkpoint,callsConsumed:2,heldCostMicros:60,entries:[{...checkpoint.entries[0],status:'responded'},{...checkpoint.entries[0],callId:'asr-2'}]});
 expect(ledger.snapshot('s').totals).toMatchObject({heldCostMicros:60,callsConsumed:2});
 expect(()=>adapter.asr({...checkpoint,context:{...context,userId:'other'}})).toThrow('SESSION_FORBIDDEN');
 }finally{ledger.close();removeAccountingTemp(dir);}
});
test('LLM adapter admits before transport and settles declared host usage without a vendor claim',()=>{
 const dir=mkdtempSync(join(tmpdir(),'model-adapter-')),ledger=openSessionAccounting(join(dir,'db.sqlite'),{now:()=>100});
 try{ledger.ensureSession({sessionId:'s',userId:'u',roleId:'java-backend',currency:'CNY',maxCostMicros:100,maxCalls:4,maxConcurrent:1,deadlineAt:10000});
 const adapter=createSessionCheckpointAdapter({ledger,binding:{sessionId:'s',userId:'u',roleId:'java-backend',runId:'r'},pricing:{source:'synthetic-token-rate',version:'1',unit:'token'}});
 const gate=createModelBudgetGate({profileId:'p',version:'1',mode:'offline-fixture',providerId:'local-fixture',modelId:'fixture',apiFamily:'fixture-only',credentialSource:{kind:'none'},
  pricing:{id:'price',version:'1',currency:'CNY',provenance:'synthetic-not-current-pricing',rates:{inputMicrosPerMillionTokens:1000000,outputMicrosPerMillionTokens:1000000}},
  limits:{maxCalls:4,maxConcurrent:1,maxInputTokens:20,maxOutputTokens:20,maxTotalTokens:100,maxCostMicros:100,maxInputCharacters:100,maxOutputCharacters:100,timeoutMs:1000}},
  {budgetId:'b',userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:10000},{now:()=>100,onCheckpoint:adapter.model});
 gate.reserve('http-1',{inputTokens:10,outputTokens:10});gate.dispatch('http-1');expect(ledger.snapshot('s').totals.activeSlots).toBe(1);
 const {currency:_,...withoutCurrency}=gate.snapshot();expect(()=>adapter.model(withoutCurrency)).toThrow('SESSION_CURRENCY_CONFLICT');
 gate.settle('http-1',{inputTokens:3,outputTokens:2,complete:true});adapter.model(gate.snapshot());
 const snapshot=ledger.snapshot('s');expect(snapshot).toMatchObject({authority:'host-supplied-not-vendor-verified',totals:{usedCostMicros:5,heldCostMicros:0,activeSlots:0}});
 expect(snapshot.entries[0]?.evidence?.kind).toBe('host-usage');
 gate.reserve('http-2',{inputTokens:10,outputTokens:10});gate.dispatch('http-2');gate.rejectHttp('http-2',429);
 expect(ledger.snapshot('s').totals).toMatchObject({usedCostMicros:5,heldCostMicros:20,activeSlots:0});
 }finally{ledger.close();removeAccountingTemp(dir);}
});
