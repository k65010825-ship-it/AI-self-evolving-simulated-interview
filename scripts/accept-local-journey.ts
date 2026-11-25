import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {runIntegratedJourney,runAbstentionJourney} from '../experiments/local-runtime/integrated-journey.ts';
import {acceptLocalAgent} from './accept-local-agent.ts';import {acceptLocalSpeechAgent} from './accept-local-speech-agent.ts';
import {collectDeliverySources} from '../evals/delivery/sources.ts';import {canonical,contentHash} from '../evals/answers/validation.ts';
const recoveryFiles=['tests/local-recovery-boundaries.test.ts','tests/local-reconciliation-atomic.test.ts','tests/local-live-host-recovery.test.ts','tests/local-process-lifecycle.test.ts','tests/local-process-integration.test.ts','tests/local-clarification-continuity.test.ts'];
/** Offline evidence only; exit 0 never denotes real-user or production-repository acceptance. */
export function localJourneyExitCode(result:{mechanismStatus:string;experienceStatus:string}){
 return result.mechanismStatus!=='passed'?1:result.experienceStatus==='passed'?0:2;
}
export async function acceptLocalJourney(){
 const root=process.cwd(),sourceManifest=await collectDeliverySources(root);await mkdir('.cache/journey-acceptance',{recursive:true});const output=await mkdtemp(resolve('.cache/journey-acceptance/run-'));
 const lanes:{id:string;status:'passed'|'failed';evidence?:unknown;errorCode?:string;evidencePath?:string}[]=[];
 async function lane(id:string,fn:()=>Promise<unknown>){const path=id.startsWith('mixed-')||id.startsWith('abstention-')?{evidencePath:join(output,id)}:{};
  try{const evidence=await fn();lanes.push({id,status:'passed',evidence,...path});return evidence;}catch(error){
  const code=(error as {code?:unknown})?.code??(error as Error)?.message;lanes.push({id,status:'failed',errorCode:typeof code==='string'&&/^[A-Z_]{1,100}$/.test(code)?code:'ACCEPTANCE_LANE_FAILED',...path});return null;}}
 const integrated=[];
 for(const roleId of ['java-backend','web-frontend'] as const){const value=await lane('mixed-'+roleId,()=>runIntegratedJourney(roleId,{evidenceDir:join(output,'mixed-'+roleId)}));if(value)integrated.push(value as Awaited<ReturnType<typeof runIntegratedJourney>>);
  await lane('abstention-'+roleId,()=>runAbstentionJourney(roleId,{evidenceDir:join(output,'abstention-'+roleId)}));}
 await lane('packaged-text-stdio',acceptLocalAgent);await lane('packaged-injected-speech-stdio',acceptLocalSpeechAgent);
 await lane('recovery-regression',async()=>{
  const env:Record<string,string>={};for(const name of ['SystemRoot','WINDIR','ComSpec','TEMP','TMP','OS','PATHEXT'])if(process.env[name])env[name]=process.env[name]!;
  const process_=Bun.spawn([process.execPath,'--no-env-file','test',...recoveryFiles],{cwd:root,env,stdout:'pipe',stderr:'pipe'});
  const [stdout,stderr,exitCode]=await Promise.all([new Response(process_.stdout).text(),new Response(process_.stderr).text(),process_.exited]);
  const log=stdout+'\n'+stderr;await writeFile(join(output,'recovery.log'),log,{flag:'wx'});
  const last=(pattern:RegExp)=>[...log.matchAll(pattern)].at(-1)?.[1],passed=Number(last(/\b(\d+) pass\b/g)),failed=Number(last(/\b(\d+) fail\b/g));
  if(exitCode!==0||!Number.isSafeInteger(passed)||passed<1||failed!==0)throw Error('RECOVERY_REGRESSION_FAILED');
  return{status:'passed',passed,failed,files:recoveryFiles,logDigest:contentHash(log),liveModelCalls:0};
 });
 const sourceStable=canonical(sourceManifest)===canonical(await collectDeliverySources(root));
 const findings=integrated.flatMap(c=>c.findings.map(f=>({roleId:c.roleId,...f})));
 const mechanismStatus=sourceStable&&lanes.every(l=>l.status==='passed')?'passed':'failed';
 const experienceStatus=findings.length?'needs-improvement':integrated.length===2&&integrated.every(c=>c.experienceStatus==='passed')?'passed':'not-evaluated';
 const body={schemaVersion:1,status:mechanismStatus==='failed'?'failed':experienceStatus==='passed'?'passed-offline-journey':'needs-improvement',mechanismStatus,experienceStatus,
  evidenceMode:'offline-synthetic',sourceStable,sourceManifest,lanes,findings,
  liveModelCalls:0,liveAsrCalls:0,liveTtsCalls:0,realUserAcceptance:false,humanReferenceCount:0,qualityClaimEligible:false,
  desktopVerified:false,microphoneVerified:false,speakerVerified:false,productionHintRepositoryVerified:false,
  limitations:['Mixed host lane uses a disposable SQLite hint fixture; it is not the production repository.',
   'Packaged production text and injected-test-only speech are separate evidence lanes, not one deployed desktop.',
   'Experience checks cover bounded synthetic progression through the turn budget, not real interview quality or elapsed-duration adequacy.',
   'All answers/audio and supplier HTTP are synthetic; no human grading, real speech quality or historical intermittent root cause claim.']};
 const reportPath=join(output,'report.json');await writeFile(reportPath,JSON.stringify({...body,digest:contentHash(body)},null,2)+'\n',{flag:'wx'});
 await writeFile(join(output,'review.md'),`# 双岗会话与恢复验收\n\n机制：${mechanismStatus}；合成体验：${experienceStatus}。\n\n${lanes.map(l=>'- '+l.id+': '+l.status+(l.evidencePath?'；材料 '+l.evidencePath:'')).join('\n')}\n\n## 未通过的体验项\n\n${findings.map(f=>'- '+f.roleId+': '+f.code).join('\n')||'本次已执行的合成体验检查无发现；不代表真人质量通过。'}\n\n正式提示repository、真人质量、麦克风/扬声器、桌面与非开发机安装未验收。报告及recovery.log保留。\n`,{flag:'wx'});
 return{output,reportPath,status:body.status,mechanismStatus,experienceStatus,lanes:lanes.length,findings:findings.length,liveModelCalls:0};
}
if(import.meta.main){const result=await acceptLocalJourney();console.log(JSON.stringify(result));process.exitCode=localJourneyExitCode(result);}
