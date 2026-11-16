import {pathToFileURL} from 'node:url';import {resolve,join,basename,dirname} from 'node:path';import {readFile,lstat} from 'node:fs/promises';
import {prepareLocalAcceptance,readLocalAcceptance,assertLocalAcceptancePath} from '../evals/local-acceptance/batch.ts';
import {executeLocalAcceptance,recoverLocalAcceptance} from '../evals/local-acceptance/runner.ts';import {rehearseLocalAcceptance} from '../evals/local-acceptance/rehearsal.ts';import {runLocalAcceptanceDrills} from '../evals/local-acceptance/drills.ts';import {contentHash} from '../evals/answers/validation.ts';
export function parseLocalAcceptanceArgs(args:string[]){
 if(args.length===0||args.length===1&&args[0]==='prepare')return{command:'prepare' as const,mode:'text' as const};
 if(args.length===3&&args[0]==='prepare'&&args[1]==='--speech-inputs')return{command:'prepare' as const,mode:'speech' as const,inputFile:resolve(args[2]!)};
 if(args.length===1&&args[0]==='demo')return{command:'demo' as const};
 if(args.length===1&&args[0]==='drills')return{command:'drills' as const};
 if(args.length===2&&['inspect','recover'].includes(args[0]!))return{command:args[0]as 'inspect'|'recover',batch:resolve(args[1]!)};
 if(args.length===5&&args[0]==='execute'&&args[2]==='--authorization'&&args[4]==='--execute')return{command:'execute' as const,batch:resolve(args[1]!),authorization:resolve(args[3]!)};
 throw Error('LOCAL_ACCEPTANCE_ARGS_INVALID');
}
async function json(path:string,max=1024*1024){if(!path.endsWith('.json'))throw Error('LOCAL_ACCEPTANCE_JSON_REQUIRED');await assertLocalAcceptancePath(path);const st=await lstat(path);if(!st.isFile()||st.size>max)throw Error('LOCAL_ACCEPTANCE_FILE_INVALID');return JSON.parse(await readFile(path,'utf8'));}
export async function localAcceptanceMain(args:string[],deps:{environment?:(name:string)=>string|undefined;log?:(value:unknown)=>void}={}){
 const p=parseLocalAcceptanceArgs(args),log=deps.log??(value=>console.log(JSON.stringify(value)));
 if(p.command==='prepare'){const prepared=await prepareLocalAcceptance(p.mode==='speech'?{mode:'speech',samples:(await json(p.inputFile!)).map((s:any)=>({...s,...(typeof s.audioPath==='string'?{audioPath:resolve(dirname(p.inputFile!),s.audioPath)}:{})}))}:{});log({output:prepared.output,batchId:prepared.batch.id,digest:prepared.batch.digest,mode:p.mode,maxRequests:prepared.batch.maxRequests,maxDeclaredCostMicros:prepared.batch.maxCostMicros,authorizationEnabled:false,credentialInspection:'not-performed',liveHttpAttempts:0});return 0;}
 if(p.command==='demo'){const r=await rehearseLocalAcceptance();log({output:r.output,report:r.reportPath,status:r.report.status,syntheticHttpAttempts:r.report.syntheticHttpAttempts,liveHttpAttempts:0});return r.report.status==='passed'?0:1;}
 if(p.command==='drills'){const r=await runLocalAcceptanceDrills();log({output:r.output,report:r.reportPath,status:r.report.status,liveHttpAttempts:0});return r.report.status==='passed-injected-test-only'?0:1;}
 if(p.command==='recover'){const r=await recoverLocalAcceptance(p.batch);log({report:r.reportPath,status:'recovery-observed',liveHttpAttempts:0,credentialRequests:0});return 0;}
 if(p.command==='inspect'){const batch=await readLocalAcceptance(p.batch);let report:any=null;try{report=await json(join(p.batch,'report.json'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(report){const {digest,...body}=report;if(contentHash(body)!==digest||report.batchDigest!==batch.digest)throw Error('LOCAL_ACCEPTANCE_REPORT_INVALID');}log({batchId:batch.id,digest:batch.digest,status:report?.status??'not-completed',maxRequests:batch.maxRequests,maxDeclaredCostMicros:batch.maxCostMicros,reportDigest:report?.digest??null,observedHttpAttempts:report?.observedHttpAttempts??null,credentialInspection:'not-performed'});return 0;}
 if(p.command==='execute'){
  if(dirname(p.authorization)!==p.batch||basename(p.authorization)!=='authorization.json')throw Error('LOCAL_ACCEPTANCE_AUTHORIZATION_PATH');
  const batch=await readLocalAcceptance(p.batch),authorization=await json(p.authorization);
  const r=await executeLocalAcceptance(p.batch,authorization,{resolveCredential:async({credentialRef})=>{const scope=batch.credentials.find(c=>c.credentialRef===credentialRef);if(!scope||!['INTERVIEW_QIANWEN_API_KEY','INTERVIEW_BAILIAN_ASR_API_KEY'].includes(scope.env))throw Error('LOCAL_ACCEPTANCE_CREDENTIAL_SCOPE');return(deps.environment??(name=>process.env[name]))(scope.env);}},{execute:true,mode:'live'});
  log({report:r.reportPath,status:r.report.status,observedHttpAttempts:r.report.observedHttpAttempts,stoppedForAccounting:r.report.stoppedForAccounting,qualityClaimEligible:false});return r.report.status==='passed-technical-acceptance'?0:1;
 }
 return 2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.exitCode=await localAcceptanceMain(process.argv.slice(2));}catch{console.error('LOCAL_ACCEPTANCE_CLI_FAILED');process.exitCode=2;}}
