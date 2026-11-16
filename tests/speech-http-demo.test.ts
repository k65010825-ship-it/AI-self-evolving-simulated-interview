import {test,expect} from 'bun:test';
import {runSpeechHttpDemo} from '../scripts/demo-speech-http.ts';
test('both roles use real local TCP upload/confirmation and SQLite reopen without repeating injected ASR',async()=>{
 for(const role of ['java-backend','web-frontend'] as const){
  const r=await runSpeechHttpDemo(role);
  expect(r).toMatchObject({roleId:role,transport:'tcp',asrTransport:'injected-http',liveAsrCalls:0,formalCommitted:false,
   status:'confirmed',reopenedStatus:'confirmed',injectedAsrCalls:1});
  expect(r.heldCostMicros).toBe(100000);expect(r.originalText).not.toBe(r.confirmedText);
 }
},15000);
