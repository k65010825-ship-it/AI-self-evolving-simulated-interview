import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {ScoringQualityAuthorizationSchema,ScoringQualityReportSchema,type ScoringQualityBatch,type ScoringQualityRow} from '../../packages/contracts/src/scoring-quality.ts';
import {createDurableLiveRunManager} from '../../apps/agent/src/runtime/durable-runtime.ts';
import type {LiveFetch} from '../../apps/agent/src/model-access/bailian-provider.ts';
import {canonical,contentHash} from '../answers/validation.ts';
import {scoringQualityAuthorization,readScoringQualityBatch,readHistoricalScoringQualityBatch,qualityJson,qualityWrite} from './batch.ts';
import {scoringQualityRequest} from './dataset.ts';import {analyzeScoringQuality,renderScoringQuality} from './metrics.ts';
import {createModelBudgetGate} from '../../apps/agent/src/model-access/budget.ts';
type Sources=()=>Promise<{path:string;sha256:string}[]>;
export async function executeScoringQuality(dir:string,rawAuthorization:unknown,deps:{readCredential:(name:string)=>string|undefined;fetch?:LiveFetch;sources?:Sources;now?:()=>number},options:{execute?:boolean;mode?:'live'|'injected-test-only'}={}){
 const batch=await readScoringQualityBatch(dir,deps.sources?{sources:deps.sources}:{}),auth=ScoringQualityAuthorizationSchema.parse(rawAuthorization),now=deps.now??Date.now,mode=options.mode??'live';
 if(options.execute!==true||!auth.operatorApproved||auth.kind!==mode||auth.expiresAt<=now()||canonical(auth)!==canonical(scoringQualityAuthorization(batch,mode,auth.expiresAt))||mode==='live'&&deps.fetch||mode==='injected-test-only'&&!deps.fetch)throw Error('SCORING_QUALITY_AUTHORIZATION_REQUIRED');
 const authorizationDigest=contentHash(auth),startedAt=now();await qualityWrite(join(batch.directory,'execution.json'),{version:1,batchDigest:batch.digest,authorization:auth,authorizationDigest,startedAt});
 const rows:ScoringQualityRow[]=batch.cases.map(c=>({caseId:c.id,status:'not_run',requestDigest:null,snapshot:null,errorCode:null,diagnostics:[]}));
 let runtime:ReturnType<typeof createDurableLiveRunManager>|undefined,httpAttempts=0,stoppedForAccounting=false,runError:'SCORING_QUALITY_RUNTIME_FAILED'|'SCORING_QUALITY_SOURCE_CHANGED'|null=null;
 let accounting:ReturnType<NonNullable<typeof runtime>['modelAccounting']>=[];
 const config={...batch.config,authorization:{enabled:true,operatorApproved:true,expiresAt:auth.expiresAt,maxRuns:8}};
 try{
  const state=join(batch.directory,'evaluation-state');await mkdir(state);
  runtime=createDurableLiveRunManager(config,{now,readCredential:name=>name==='INTERVIEW_QIANWEN_API_KEY'?deps.readCredential(name):undefined,
   fetch:async(input,init)=>{if(now()>=auth.expiresAt||httpAttempts>=batch.maxRequests)throw Error('SCORING_QUALITY_HTTP_LIMIT');httpAttempts++;return(deps.fetch??globalThis.fetch)(input,init);}},
   {path:join(state,'evaluation.sqlite'),ownerId:randomUUID()});
  const blocked=()=>runtime!.modelAccounting().some(s=>s.locked||s.entries.some(e=>e.status==='unknown'||e.status==='dispatched'));
  for(let i=0;i<batch.cases.length;i++){
   if(blocked()){stoppedForAccounting=true;break;}if(now()>=auth.expiresAt){runError='SCORING_QUALITY_RUNTIME_FAILED';break;}
   const sample=batch.cases[i]!,runId='sq-'+batch.id+'-'+i,req=scoringQualityRequest(sample,startedAt,Math.min(now()+30000,auth.expiresAt),runId),row=rows[i]!;
   const requestDigest=contentHash(req);await qualityWrite(join(batch.directory,sample.id+'.request.json'),req);row.requestDigest=requestDigest;
   try{runtime.start(req);await runtime.wait(runId);row.snapshot=runtime.snapshot(runId);row.status=row.snapshot.status==='completed'?'completed':'failed';row.errorCode=row.snapshot.error?.code??null;}
   catch{row.status='failed';row.errorCode='DEPENDENCY_UNAVAILABLE';}
   row.diagnostics=runtime.evaluationDiagnostics().find(d=>d.runId===runId)?.events??[];
   await qualityWrite(join(batch.directory,sample.id+'.row.json'),row);
   if(row.diagnostics.some(d=>d.reason==='json-mode-http-rejected')){runError='SCORING_QUALITY_RUNTIME_FAILED';break;}
  }
  stoppedForAccounting||=blocked();accounting=runtime.modelAccounting();
 }catch{runError='SCORING_QUALITY_RUNTIME_FAILED';}
 finally{if(runtime){try{accounting=runtime.modelAccounting();await runtime.shutdown({graceMs:1000,cancelWaitMs:1000});runtime.close();}catch{runError='SCORING_QUALITY_RUNTIME_FAILED';}}}
 try{await readScoringQualityBatch(dir,deps.sources?{sources:deps.sources}:{});}catch{runError='SCORING_QUALITY_SOURCE_CHANGED';}
 const analysis=analyzeScoringQuality(batch.cases,rows),totals={httpAttempts,dispatchedAttempts:accounting.flatMap(s=>s.entries).filter(e=>!['reserved','released'].includes(e.status)).length,
  usedTokens:accounting.reduce((n,s)=>n+s.totals.usedTokens,0),heldTokens:accounting.reduce((n,s)=>n+s.totals.heldTokens,0),usedCostMicros:accounting.reduce((n,s)=>n+s.totals.usedCostMicros,0),heldCostMicros:accounting.reduce((n,s)=>n+s.totals.heldCostMicros,0)};
 const body={version:1 as const,scope:'shared-scoring-core' as const,mode:mode==='live'?'live-http' as const:'injected-http' as const,batchDigest:batch.digest,authorizationDigest,startedAt,finishedAt:now(),
  status:analysis.draftChecksPassed&&!runError&&!stoppedForAccounting?'passed-draft-checks' as const:'failed-draft-checks' as const,runError,stoppedForAccounting,rows,analysis,accounting,totals,humanReferenceCount:0 as const,qualityClaimEligible:false as const,formalCommitted:false as const,vendorBillingVerified:false as const};
 const report=ScoringQualityReportSchema.parse({...body,digest:contentHash(body)});await qualityWrite(join(batch.directory,'report.json'),report);
 await writeFile(join(batch.directory,'report.md'),renderScoringQuality(batch,report)+'\n',{flag:'wx'});
 return{output:batch.directory,report,reportPath:join(batch.directory,'report.json')};
}
/** Historical read/recompute only; never resumes SDK work, refreshes quota, or reads credentials. */
export async function inspectScoringQuality(dir:string){
 const batch=await readHistoricalScoringQualityBatch(dir),report=ScoringQualityReportSchema.parse(await qualityJson(join(batch.directory,'report.json'))),{digest,...body}=report;
 const claim=await qualityJson(join(batch.directory,'execution.json')),auth=ScoringQualityAuthorizationSchema.parse(claim.authorization);
 if(contentHash(body)!==digest||report.finishedAt<report.startedAt||claim.startedAt!==report.startedAt||claim.batchDigest!==batch.digest||report.batchDigest!==batch.digest||report.authorizationDigest!==contentHash(auth)||claim.authorizationDigest!==report.authorizationDigest||canonical(auth)!==canonical(scoringQualityAuthorization(batch,auth.kind,auth.expiresAt))||
  report.mode!==(auth.kind==='live'?'live-http':'injected-http')||canonical(analyzeScoringQuality(batch.cases,report.rows))!==canonical(report.analysis))throw Error('SCORING_QUALITY_REPORT_INVALID');
 const expected=report.analysis.draftChecksPassed&&!report.runError&&!report.stoppedForAccounting?'passed-draft-checks':'failed-draft-checks';if(report.status!==expected)throw Error('SCORING_QUALITY_REPORT_INVALID');
 for(const s of report.accounting)createModelBudgetGate(batch.config.profile,s.scope,{restore:s,allowLive:true});
 const totals={httpAttempts:report.totals.httpAttempts,dispatchedAttempts:report.accounting.flatMap(s=>s.entries).filter(e=>!['reserved','released'].includes(e.status)).length,
  usedTokens:report.accounting.reduce((n,s)=>n+s.totals.usedTokens,0),heldTokens:report.accounting.reduce((n,s)=>n+s.totals.heldTokens,0),usedCostMicros:report.accounting.reduce((n,s)=>n+s.totals.usedCostMicros,0),heldCostMicros:report.accounting.reduce((n,s)=>n+s.totals.heldCostMicros,0)};
 if(canonical(totals)!==canonical(report.totals)||totals.httpAttempts>totals.dispatchedAttempts)throw Error('SCORING_QUALITY_REPORT_INVALID');
 return{batch,report};
}
