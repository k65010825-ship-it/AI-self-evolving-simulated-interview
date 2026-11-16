import {expect,test} from 'bun:test';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {writeAgentJourney,verifyAgentJourney} from '../evals/journey/index.ts';
import {createHash} from 'node:crypto';
import {contentHash} from '../evals/answers/validation.ts';

test('both roles share a real two-session workflow through failure, disk memory, revision and TCP preview',async()=>{
 const result=await writeAgentJourney();expect(result.liveModelCalls).toBe(0);expect(result.qualityClaimEligible).toBe(false);expect(result.roles).toHaveLength(2);
 for(const r of result.roles){expect(Object.values(r.checks).every(Boolean)).toBe(true);expect(r.scoredTurns).toBe(3);expect(r.failedRuns).toBe(1);expect(r.recalledObservations).toBe(2);}
 const verified=await verifyAgentJourney(result.output);expect(verified.verified).toBe(true);expect(verified.roles).toEqual(result.roles);
 const env:Record<string,string>={CI:'1',NO_COLOR:'1'};for(const k of ['PATH','SystemRoot','WINDIR','ComSpec','PATHEXT','TEMP','TMP','OS'])if(process.env[k])env[k]=process.env[k]!;
 const child=Bun.spawnSync([process.execPath,'--no-env-file',resolve('scripts/agent-journey.ts'),'--verify',result.output],{env,stdout:'pipe',stderr:'pipe',timeout:30000,windowsHide:true});
 expect(child.exitCode).toBe(0);expect(JSON.parse(new TextDecoder().decode(child.stdout)).verified).toBe(true);
 const path=join(result.output,'java-backend.memory.json'),before=await readFile(path);await writeFile(path,'{}');
 try{await expect(verifyAgentJourney(result.output)).rejects.toThrow('AGENT_JOURNEY_INVALID');}finally{await writeFile(path,before);}
 const reportPath=join(result.output,'report.json'),casePath=join(result.output,'java-backend.case.json');
 const reportBefore=await readFile(reportPath),caseBefore=await readFile(casePath);
 for(const mutation of ['score','trace'] as const){
  const report=JSON.parse(reportBefore.toString()),c=JSON.parse(caseBefore.toString());
  if(mutation==='score')c.second.closeout.report.assessments[0].evaluation.normalizedScore=1;
  else c.trace.find((t:{step:string})=>t.step==='second.preview').requestDigest='0'.repeat(64);
  const data=Buffer.from(JSON.stringify(c));await writeFile(casePath,data);
  report.files.find((f:{name:string})=>f.name==='java-backend.case.json').sha256=createHash('sha256').update(data).digest('hex');
  const {digest:ignored,...body}=report;void ignored;report.digest=contentHash(body);await writeFile(reportPath,JSON.stringify(report));
  try{await expect(verifyAgentJourney(result.output)).rejects.toThrow('AGENT_JOURNEY_INVALID');}finally{await writeFile(casePath,caseBefore);await writeFile(reportPath,reportBefore);}
 }
},60000);
