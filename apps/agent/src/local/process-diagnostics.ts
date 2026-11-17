import {LocalRuntimeDiagnosticFrameSchema} from '../../../../packages/contracts/src/local-process.ts';
/** Optional diagnostic writes must never fail the actual transport or retain arbitrary dependency text. */
export function createRuntimeDiagnostics(sink:(line:string)=>unknown){let bytes=0;
 return(raw:unknown)=>{const p=LocalRuntimeDiagnosticFrameSchema.safeParse({type:'runtime-diagnostic',schemaVersion:1,...(raw&&typeof raw==='object'?raw:{})});
  if(!p.success)return;const line=JSON.stringify(p.data)+'\n',size=Buffer.byteLength(line);if(bytes+size>16384)return;bytes+=size;
  try{sink(line);}catch{/* diagnostics are best effort, not a second failure source */}
 };
}
