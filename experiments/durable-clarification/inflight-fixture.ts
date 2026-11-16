import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import config from '../../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
import {initialClarificationRequest,continuationRequest} from './fixture.ts';
import {AgentRunRequestSchema} from '../../packages/contracts/src/agent-run.ts';
import type {RoleId} from '../../packages/contracts/src/tools.ts';
export async function createInflightClarificationCrash(role:RoleId){
 const root=join(process.cwd(),'.cache','inflight-clarification');mkdirSync(root,{recursive:true});const output=mkdtempSync(join(root,'run-'));
 const database=join(output,'agent.sqlite'),metrics=join(output,'child-metrics.json'),payload=join(output,'payload.json'),continuation=join(output,'continuation.json');
 const c={...config,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+120000,maxRuns:8}},first=initialClarificationRequest(role);
 writeFileSync(payload,JSON.stringify({config:c,request:first.request,output:first.output,database,metrics,continuation}));
 const child=Bun.spawn([process.execPath,'--no-env-file',resolve('experiments/durable-clarification/inflight-child.ts'),payload],{cwd:process.cwd(),stdout:'ignore',stderr:'pipe'});
 const timeout=setTimeout(()=>child.kill(),15000);let childExitCode:number;try{childExitCode=await child.exited;}finally{clearTimeout(timeout);}
 if(childExitCode!==23)throw Error('INFLIGHT_CLARIFICATION_CHILD_FAILED');
 const m=JSON.parse(readFileSync(metrics,'utf8')) as {httpAttempts:number;credentialReads:number;firstResultDigest:string;firstBudgetDigest:string;heldTokens:number};
 const pending=JSON.parse(readFileSync(continuation,'utf8')) as ReturnType<typeof continuationRequest>;
 const crashed=AgentRunRequestSchema.parse(pending.request);if(crashed.job.type!=='turn')throw Error('INFLIGHT_FIXTURE_INVALID');
 const context={...crashed.context,runId:crashed.context.runId+'-replacement',attemptId:'replacement'};
 const replacement=AgentRunRequestSchema.parse({...crashed,inputSnapshotId:context.runId,context,job:{...crashed.job,input:{...crashed.job.input,context,answer:{...crashed.job.input.answer,id:'replacement-answer'}}}});
 return {output,database,c,first,m,pending,crashed,replacement,childExitCode,now:Date.now()+15000};
}
