import {LocalEventSchema} from '../../packages/contracts/src/local-runtime.ts';
import type {EvaluationDiagnostic} from '../../packages/contracts/src/evaluation-diagnostic.ts';

/** Bounded replay of typed, fixed-category host events; never copies model/provider text. */
export async function readJobDiagnostics(jobId:string,read:(afterSeq:number)=>Promise<unknown>){
 const diagnostics:EvaluationDiagnostic[]=[];let afterSeq=0;
 for(let page=0;page<16;page++){
  const raw=await read(afterSeq);
  if(!Array.isArray(raw)||raw.length>100)throw Error('LOCAL_ACCEPTANCE_DIAGNOSTICS_UNAVAILABLE');
  for(const item of raw){const event=LocalEventSchema.parse(item);
   if(event.jobId!==jobId||event.seq<=afterSeq)throw Error('LOCAL_ACCEPTANCE_DIAGNOSTICS_UNAVAILABLE');
   afterSeq=event.seq;if(event.diagnostic){if(diagnostics.length>=64)throw Error('LOCAL_ACCEPTANCE_DIAGNOSTICS_UNAVAILABLE');diagnostics.push(event.diagnostic);}
  }
  if(raw.length<100)return{diagnostics,diagnosticCapture:diagnostics.length?'recorded' as const:'none' as const};
 }
 throw Error('LOCAL_ACCEPTANCE_DIAGNOSTICS_UNAVAILABLE');
}
