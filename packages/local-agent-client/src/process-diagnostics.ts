import {LocalRuntimeDiagnosticFrameSchema,LocalProcessDiagnosticSchema,LocalProcessDiagnosticsSchema,LocalProcessFailureContextSchema,type LocalProcessDiagnostic} from '../../contracts/src/local-process.ts';
type Event=Omit<LocalProcessDiagnostic,'seq'|'elapsedMs'>;
/** Private stderr is never forwarded verbatim; even schema-looking messages with extra fields are dropped. */
export function createProcessDiagnostics(onDiagnostic?:(event:LocalProcessDiagnostic)=>void){
 const start=performance.now(),events:LocalProcessDiagnostic[]=[];let seq=0,discarded=0,pending='',dropping=false;
 function record(raw:Event){const parsed=LocalProcessDiagnosticSchema.safeParse({...raw,seq:seq+1,elapsedMs:Math.max(0,Math.floor(performance.now()-start))});
  if(!parsed.success)return;seq++;if(events.length===64){events.shift();discarded++;}events.push(parsed.data);
  try{onDiagnostic?.(structuredClone(parsed.data));}catch{/* Observers cannot break transport. */}
 }
 function stderr(chunk:Buffer){
  // Byte-wise bounded line buffering; malformed UTF-8 and oversized lines cannot retain unbounded memory.
  for(const byte of chunk){if(byte===10){if(!dropping){try{const frame=LocalRuntimeDiagnosticFrameSchema.safeParse(JSON.parse(pending));
    if(frame.success){const {type,schemaVersion,...data}=frame.data;record({source:'runtime',...data});}}catch{/* Drop arbitrary dependency stderr. */}}
    pending='';dropping=false;
   }else if(!dropping){if(byte>127||pending.length>=4096){pending='';dropping=true;}else pending+=String.fromCharCode(byte);}
  }
 }
 return{record,stderr,snapshot:()=>LocalProcessDiagnosticsSchema.parse({schemaVersion:1,events:structuredClone(events),discarded}),
  context:()=>LocalProcessFailureContextSchema.parse({schemaVersion:1,lastClient:events.findLast(e=>e.source==='client')??null,lastRuntime:events.findLast(e=>e.source==='runtime')??null,discarded})};
}
