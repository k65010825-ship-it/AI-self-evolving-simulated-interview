import { test, expect } from 'bun:test';
import { runSpeechDemo } from '../scripts/demo-speech.ts';

test('two roles create offline speech answer candidates with explicit synthetic provenance',async()=>{
  for(const role of ['java-backend','web-frontend']as const){
    const demo=await runSpeechDemo(role);
    expect(demo.candidateKind).toBe('uncommitted-speech-answer');
    expect(demo.mode).toBe('offline-fixture');expect(demo.liveModelCalls).toBe(0);
    expect(demo.durationMs).toBe(6000);expect(demo.activeAudioMs).toBe(4000);
    expect(demo.unitsPerMinute).toBe(120);expect(demo.committed).toBe(false);
  }
});
