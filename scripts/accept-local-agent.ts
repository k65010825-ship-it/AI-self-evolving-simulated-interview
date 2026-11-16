import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {buildLocalAgent} from './build-local-agent.ts';import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';
import {collectDeliverySources} from '../evals/delivery/sources.ts';import {canonical,contentHash} from '../evals/answers/validation.ts';
export async function acceptLocalAgent(){
 const sourceManifest=await collectDeliverySources(process.cwd()),artifact=await buildLocalAgent(),root=resolve('.cache/local-runtime-acceptance');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 const dataDir=join(output,'用户数据'),cwd=join(output,'独立工作目录');await mkdir(cwd);const cases:{role:string;sessionId:string;firstMemoryVersion:number;recalled:number}[]=[];
 const connect=()=>spawnLocalAgent({...artifact,dataDir,cwd});let client=await connect();
 const run=async(method:Parameters<typeof client.request>[0],params:unknown)=>{const r=await client.request(method,params) as {jobId:string;sessionId:string};const j=await client.waitForJob(r.jobId) as {status:string};if(j.status!=='completed')throw Error('LOCAL_ACCEPTANCE_JOB_FAILED');return r;};
 try{await client.request('runtime.initialize',{});
  for(const roleId of ['java-backend','web-frontend']as const){const c=await run('session.create',{operationId:'create-'+roleId,roleId,goal:'离线随包验收',durationMinutes:20});
   await run('session.nextQuestion',{operationId:'plan-'+roleId,sessionId:c.sessionId,expectedRevision:0});
   await run('session.answer',{operationId:'answer-'+roleId,sessionId:c.sessionId,expectedRevision:1,text:'我会明确原子边界、异常处理与验证条件，并通过重复实验检查结果。'});
   const f=await run('session.complete',{operationId:'finish-'+roleId,sessionId:c.sessionId,expectedRevision:2});
   const memory=await client.request('memory.get',{roleId}) as {version:number};if(memory.version!==1)throw Error('LOCAL_MEMORY_MISSING');
   const events=await client.request('job.events',{jobId:f.jobId,afterSeq:0}) as {seq:number;status:string}[];if(events.at(-1)?.status!=='completed')throw Error('LOCAL_COMMIT_EVENT_MISSING');
   cases.push({role:roleId,sessionId:c.sessionId,firstMemoryVersion:memory.version,recalled:0});
  }
  await client.close();client=await connect();await client.request('runtime.initialize',{});
  for(const c of cases){const again=await client.request('session.create',{operationId:'create-'+c.role,roleId:c.role,goal:'离线随包验收',durationMinutes:20}) as {sessionId:string};if(again.sessionId!==c.sessionId)throw Error('LOCAL_IDEMPOTENCY_FAILED');
   const next=await run('session.create',{operationId:'next-'+c.role,roleId:c.role,goal:'复测',durationMinutes:20});const view=await client.request('session.get',{sessionId:next.sessionId})as {priorEvidenceCount:number};c.recalled=view.priorEvidenceCount;if(c.recalled<1)throw Error('LOCAL_RECALL_MISSING');
  }
  const status=await client.request('runtime.status',{});await client.close();
  if(canonical(sourceManifest)!==canonical(await collectDeliverySources(process.cwd())))throw Error('LOCAL_SOURCE_CHANGED');
  const body={version:1,status:'passed-offline-local-runtime',artifact,cases,dataDir,cwd,runtimeStatus:status,sourceManifest,
   liveModelCalls:0,humanReferenceCount:0,qualityClaimEligible:false,desktopInstallerVerified:false,credentialVaultVerified:false,speechMigrated:false};
  await writeFile(join(output,'report.json'),JSON.stringify({...body,digest:contentHash(body)},null,2)+'\n',{flag:'wx'});return{output,artifact:artifact.output,status:body.status,cases:cases.length,liveModelCalls:0};
 }finally{await client.close();}
}
if(import.meta.main){try{console.log(JSON.stringify(await acceptLocalAgent()));}catch{console.error('LOCAL_ACCEPTANCE_FAILED');process.exitCode=1;}}
