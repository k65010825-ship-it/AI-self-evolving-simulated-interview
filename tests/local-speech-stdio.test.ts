import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {runSpeechStdioScenario} from './helpers/local-speech-config.ts';
test('two roles use real Pi and private stdio with injected LLM/ASR/TTS HTTP, confirm formal answers and restore without audio or dispatch',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'本地 speech stdio 空格-'));
 try{const result=await runSpeechStdioScenario({executable:process.execPath,entry:resolve('experiments/local-runtime/speech-fixture.ts'),assetsRoot:process.cwd(),dataDir,cwd:tmpdir()});expect(result.cases).toHaveLength(2);expect(result.cases.every(c=>c.restored&&c.completed)).toBe(true);expect(result.syntheticHttpCalls).toEqual({llm:6,asr:2,tts:2});expect(result.resolverCounts).toEqual({llm:4,asr:2,tts:2});expect(result.secretScan.passed).toBe(true);}
 finally{await rm(dataDir,{recursive:true,force:true});}
},60000);
