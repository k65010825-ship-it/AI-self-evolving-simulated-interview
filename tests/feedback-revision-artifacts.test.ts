import {expect,test} from 'bun:test';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {writeFeedbackRevisionDemo,replayFeedbackRevisionDemo} from '../evals/feedback-revision/demo.ts';

test('fresh CLI process reconstructs both roles from JSON without models; changed artifacts are refused',async()=>{
 const d=await writeFeedbackRevisionDemo();expect(d.liveModelCalls).toBe(0);expect(d.roles).toBe(2);expect(d.versions.every(v=>v.versions===3&&v.withheldItems===1)).toBe(true);
 const env:Record<string,string>={CI:'1',NO_COLOR:'1'};for(const k of ['PATH','SystemRoot','WINDIR','ComSpec','PATHEXT','TEMP','TMP','OS'])if(process.env[k])env[k]=process.env[k]!;
 const child=Bun.spawnSync([process.execPath,'--no-env-file',resolve('scripts/feedback-revision.ts'),'--replay',d.output],{env,stdout:'pipe',stderr:'pipe',timeout:30000,windowsHide:true});
 expect(child.exitCode).toBe(0);const result=JSON.parse(new TextDecoder().decode(child.stdout));expect(result.versions).toEqual(d.versions);expect(result.liveModelCalls).toBe(0);
 const path=join(d.output,'display-feedback.json'),before=await readFile(path);await writeFile(path,'{}');
 try{await expect(replayFeedbackRevisionDemo(d.output)).rejects.toThrow('FEEDBACK_REVISION_ARTIFACT_INVALID');}finally{await writeFile(path,before);}
},60000);
