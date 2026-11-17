import {createRuntimeDiagnostics} from './process-diagnostics.ts';
import {LocalStartupFailureCodeSchema} from '../../../../packages/contracts/src/local-process.ts';
// Diagnostics are best effort; a closed stderr reader must not become an unhandled process error.
process.stderr.on('error',()=>{});
const diagnose=createRuntimeDiagnostics(line=>process.stderr.write(line));diagnose({stage:'startup',code:'BOOTSTRAP_STARTED'});
try{
 const {serveLocalStdio}=await import('./stdio.ts');
 const args=process.argv.slice(2),values=new Map<string,string>();
 for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--data-dir','--assets-root','--lease-ms'].includes(key)||!value||values.has(key))throw Error();values.set(key,value);}
 const dataDir=values.get('--data-dir'),assetsRoot=values.get('--assets-root');if(!dataDir||!assetsRoot)throw Error();
 await serveLocalStdio({dataDir,assetsRoot,...(values.has('--lease-ms')?{leaseMs:Number(values.get('--lease-ms'))}:{})});
}catch(error){const failure=LocalStartupFailureCodeSchema.safeParse((error as {code?:unknown}|null)?.code);
 diagnose({stage:'startup',code:'STARTUP_FAILED',...(failure.success?{failureCode:failure.data}:{})});process.stdin.destroy();process.exitCode=1;}
