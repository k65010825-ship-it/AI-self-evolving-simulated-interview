import {expect,test} from 'bun:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runLocalAcceptanceDrills,drillScenarios} from '../evals/local-acceptance/drills.ts';
import {contentHash} from '../evals/answers/validation.ts';
test('five injected faults preserve real stdio/SQLite failure and recovery evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'acceptance-drills-'));
 try{
  const {output,report,reportPath}=await runLocalAcceptanceDrills({outputRoot:root});
  expect(output.startsWith(root)).toBe(true);expect(JSON.parse(await readFile(reportPath,'utf8'))).toEqual(report);
  expect(report.status).toBe('passed-injected-test-only');expect(report.cases).toHaveLength(5);
  expect(report.cases.map(c=>({scenario:c.scenario,status:c.status,errorCode:c.errorCode}))).toEqual(drillScenarios.map(scenario=>({scenario,status:'passed' as const,errorCode:undefined})));
  expect(report.syntheticHTTPCounters).toEqual({llm:10,asr:4,tts:0});expect(report.liveCalls).toBe(0);expect(report.realCredentialReads).toBe(0);expect(report.qualityClaimEligible).toBe(false);
  const {digest,...body}=report;expect(digest).toBe(contentHash(body));
  const crash=report.cases.find(c=>c.scenario==='crash-after-dispatch')!;expect(crash.resolverCounts.recover).toBe(0);expect(crash.budget.attempts[0].status).toBe('unknown');
  expect(report.cases.every(c=>c.checks.every((x:{passed:boolean})=>x.passed))).toBe(true);
 }finally{await rm(root,{recursive:true,force:true});}
},120000);
test('unknown or duplicate scenario is rejected before constructing an artifact',async()=>{
 await expect(runLocalAcceptanceDrills({scenarios:['asr-429','asr-429']})).rejects.toThrow('DRILL_SCENARIOS_INVALID');
});
