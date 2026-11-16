import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import example from '../apps/agent/src/model-access/qianwen.example.json' with { type:'json' };
import { readLiveServiceConfig } from '../apps/agent/src/model-access/read-live-config.ts';
import { prepareBailianAcceptance,runBailianAcceptance } from '../evals/live-bailian/runner.ts';
import { prepareAcceptanceBundle,writeAcceptanceBundle } from '../evals/live-bailian/bundle.ts';
export function parseLiveAcceptanceArgs(args:string[]) {
 let configPath:string|undefined,execute=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--execute'&&!execute){execute=true;continue;}
  if(args[i]==='--config'&&!configPath&&args[i+1]&&!args[i+1]!.startsWith('--')){configPath=resolve(args[++i]!);continue;}
  throw Error('ACCEPTANCE_ARGS_INVALID');
 }
 if(execute&&!configPath)throw Error('ACCEPTANCE_EXPLICIT_CONFIG_REQUIRED');
 return{execute,configPath};
}
export async function liveAcceptanceMain(args:string[]) {
 const options=parseLiveAcceptanceArgs(args),config=options.configPath?await readLiveServiceConfig(options.configPath):example;
 const plan=prepareBailianAcceptance(config);
 if(!options.execute){console.log(JSON.stringify(plan));return 0;}
 if(!plan.readyToExecute)throw Error('ACCEPTANCE_NOT_AUTHORIZED_OR_READY');
 const dir=await prepareAcceptanceBundle(process.cwd(),plan),controller=new AbortController();
 const cancel=()=>controller.abort();process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
 try{
  const result=await runBailianAcceptance(config,{readCredential:name=>process.env[name]},{execute:true,signal:controller.signal});
  const report=await writeAcceptanceBundle(dir,result);
  if(result.mode==='plan-only')throw Error('ACCEPTANCE_EXECUTION_REQUIRED');
  console.log(JSON.stringify({mode:result.mode,status:result.status,report,httpAttempts:result.httpAttempts,settledTokens:result.settledTokens,
   declaredCostMicros:result.declaredCostMicros,heldCostMicros:result.heldCostMicros,humanReview:'pending',vendorBillingVerified:false}));
  return result.status==='passed-mechanics'?0:1;
 }finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exitCode=await liveAcceptanceMain(process.argv.slice(2));}
 catch{console.error('LIVE_ACCEPTANCE_FAILED');process.exitCode=2;}
}
