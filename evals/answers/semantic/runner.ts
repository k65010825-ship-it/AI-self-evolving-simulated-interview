import { z } from 'zod';
import { SemanticVerdictSchema,type SemanticRequest,type SemanticRow } from '../../../packages/contracts/src/semantic-evaluation.ts';
import { AgentStateError } from '../../../apps/agent/src/planning/interview-state.ts';
import { collectDeliverySources } from '../../delivery/sources.ts';
import { canonical,contentHash } from '../validation.ts';
import { loadSemanticDataset,compileSemanticDataset } from './dataset.ts';
import { sealSemanticReport } from './report.ts';
import { createAlwaysSupportedJudge } from './pi-judge.ts';
type Judge=(request:SemanticRequest,signal:AbortSignal)=>Promise<unknown>;
const options=z.object({evaluatorId:z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/).default('injected-offline-judge'),
 split:z.literal('development').default('development'),timeoutMs:z.number().int().min(1).max(30000).default(5000)}).strict();
export async function runSemanticBenchmark(input:{judge:Judge;signal?:AbortSignal;evaluatorId?:string;timeoutMs?:number;split?:'development'}){
 const{judge,signal,...raw}=input,config=options.safeParse(raw);if(!config.success||typeof judge!=='function')throw new Error('SEMANTIC_OPTIONS_INVALID');
 const dataset=compileSemanticDataset(loadSemanticDataset()),sourceManifest=await collectDeliverySources(process.cwd()),startedAt=new Date().toISOString(),rows:SemanticRow[]=[];
 for(const s of dataset.samples){
  if(signal?.aborted){rows.push({claimId:s.id,status:'cancelled',error:'RUN_CANCELLED'});continue;}
  const controller=new AbortController(),deadline=performance.now()+config.data.timeoutMs;
  let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  const check=()=>{if(signal?.aborted)throw new AgentStateError('RUN_CANCELLED');if(controller.signal.aborted||performance.now()>=deadline)throw new AgentStateError('DEADLINE_EXCEEDED');};
  try{
   const stop=new Promise<never>((_,reject)=>{abort=()=>{controller.abort();reject(new AgentStateError('RUN_CANCELLED'));};signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{controller.abort();reject(new AgentStateError('DEADLINE_EXCEEDED'));},config.data.timeoutMs);});
   const output=await Promise.race([Promise.resolve().then(()=>{check();return judge(structuredClone(s.request),controller.signal);}),stop]);check();
   const p=SemanticVerdictSchema.safeParse(output);if(!p.success)throw new AgentStateError('MODEL_OUTPUT_INVALID');check();
   rows.push({claimId:s.id,status:'completed',verdict:p.data.verdict,verdictDigest:contentHash(p.data)});
  }catch(e){const error=e instanceof AgentStateError?e.code:'DEPENDENCY_UNAVAILABLE';rows.push({claimId:s.id,status:error==='RUN_CANCELLED'?'cancelled':error==='DEADLINE_EXCEEDED'?'timed_out':'failed',error});}
  finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);}
 }
 let sourceStable=false;try{sourceStable=canonical(sourceManifest)===canonical(await collectDeliverySources(process.cwd()));}catch{/* failed source collection */}
 return sealSemanticReport({evaluatorId:config.data.evaluatorId,startedAt,finishedAt:new Date().toISOString(),sourceManifest,sourceStable,rows});
}
export async function runOfflineSemanticBenchmark(observe?:(request:SemanticRequest)=>void){
 const f=await createAlwaysSupportedJudge();
 const report=await runSemanticBenchmark({evaluatorId:'always-supported-pi-fixture',judge:(request,signal)=>{observe?.(structuredClone(request));return f.judge(request,signal);}});
 if(f.stats.liveModelCalls!==0)throw new Error('SEMANTIC_FIXTURE_BOUNDARY_INVALID');return report;
}

