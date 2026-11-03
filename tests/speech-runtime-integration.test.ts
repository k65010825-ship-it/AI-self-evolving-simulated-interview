import{test,expect}from'bun:test';
import{runSpeechRuntimeDemo}from'../scripts/demo-speech-runtime.ts';
for(const roleId of ['java-backend','web-frontend']as const){
 test(`confirmed speech traverses TCP HTTP/SSE and real Pi fixture for ${roleId}`,async()=>{
  const d=await runSpeechRuntimeDemo(roleId);
  expect(d.turnStatus).toBe('completed');expect(d.reportStatus).toBe('completed');expect(d.liveModelCalls).toBe(0);
  expect(d.expressionStatus).toBe('audio_descriptions');expect(d.speechEvidenceMode).toBe('offline-fixture');
  expect(d.originalUnitsPerMinute).toBe(120);expect(d.confirmedTextMatches).toBe(true);
  expect(d.speechCoverage).toEqual({totalAnswers:1,speechAnswers:1,textAnswers:0,descriptiveAnswers:1,insufficientAnswers:0});
  expect(d.committed).toBe(false);
 });
}
