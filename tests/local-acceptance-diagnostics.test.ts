import {test,expect} from 'bun:test';
import {readJobDiagnostics} from '../evals/local-acceptance/diagnostics.ts';
const diagnostic={version:1 as const,stage:'schema' as const,outcome:'rejected' as const,reason:'invalid-schema' as const,schemaIssue:{field:'criterionScores.score' as const,issue:'invalid_type' as const,receivedType:'string' as const}};
const event=(seq:number)=>({jobId:'j',seq,status:'running',stage:'schema',...(seq===101?{diagnostic}:{})});
test('diagnostic replay follows afterSeq pagination and retains typed field rejection',async()=>{
 const events=Array.from({length:105},(_,i)=>event(i+1)),cursors:number[]=[];
 const r=await readJobDiagnostics('j',async after=>{cursors.push(after);return events.filter(e=>e.seq>after).slice(0,100);});
 expect(cursors).toEqual([0,100]);expect(r).toEqual({diagnosticCapture:'recorded',diagnostics:[diagnostic]});
});
test('historical events without diagnostics remain none rather than a claimed diagnosis',async()=>{
 expect(await readJobDiagnostics('j',async()=>[event(1)])).toEqual({diagnosticCapture:'none',diagnostics:[]});
});
test('diagnostic replay refuses mixed jobs, duplicate sequence, unknown strings and unbounded pages',async()=>{
 for(const raw of [[{...event(101),jobId:'other'}],[event(1),event(1)],[{...event(101),diagnostic:{...diagnostic,message:'private-generation'}}],Array.from({length:101},(_,i)=>event(i+1))]){
  let failed=false;try{await readJobDiagnostics('j',async()=>raw);}catch{failed=true;}expect(failed).toBe(true);
 }
 let reads=0;await expect(readJobDiagnostics('j',async after=>{reads++;return Array.from({length:100},(_,i)=>event(after+i+1));})).rejects.toThrow('LOCAL_ACCEPTANCE_DIAGNOSTICS_UNAVAILABLE');expect(reads).toBe(16);
});
