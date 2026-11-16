import {z} from 'zod';
import {AgentStateError} from '../planning/interview-state.ts';
const Usage=z.object({prompt_tokens:z.number().int().nonnegative().max(10_000_000),completion_tokens:z.number().int().nonnegative().max(10_000_000),total_tokens:z.number().int().nonnegative().max(20_000_000)})
 .refine(u=>u.prompt_tokens+u.completion_tokens===u.total_tokens);
const Chunk=z.object({choices:z.array(z.object({index:z.literal(0),finish_reason:z.union([z.literal('stop'),z.null()]).optional(),
 delta:z.object({role:z.literal('assistant').optional(),content:z.string().nullable().optional(),reasoning_content:z.union([z.literal(''),z.null()]).optional(),refusal:z.null().optional()}).strict(),
})).max(1),usage:Usage.nullable().optional()});
/** Bounded, complete SSE only. Partial text is never returned as a transcript. */
export function parseOmniTranscript(bytes:Uint8Array){
 const bad=():never=>{throw new AgentStateError('MODEL_OUTPUT_INVALID');};
 if(bytes.length>262144)bad();let source:string;
 try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return bad();}
 let done=false,finished=false,text='',count=0,data:string[]=[];
 let usage:z.infer<typeof Usage>|undefined;
 const consume=()=>{
  if(!data.length)return;const payload=data.join('\n');data=[];
  if(done||++count>4096)bad();if(payload==='[DONE]'){if(!finished)bad();done=true;return;}
  let raw:unknown;try{raw=JSON.parse(payload);}catch{return bad();}
  if(raw&&typeof raw==='object'&&'error' in raw)bad();
  const p=Chunk.safeParse(raw);if(!p.success)return bad();
  const c=p.data;
  if(c.usage){if(usage||!finished||c.choices.length)bad();usage=c.usage;}
  if(!c.choices.length){if(!c.usage)bad();return;}
  if(finished)bad();const choice=c.choices[0]!;
  text+=choice.delta.content??'';if(text.length>10000)bad();
  if(choice.finish_reason==='stop')finished=true;
 };
 const lines=source.split(/\r\n|\r|\n/);if(lines.pop()!=='')bad();
 for(const line of lines){
  if(line===''){consume();continue;}
  if(line.startsWith(':'))continue;
  if(line.startsWith('data:')){data.push(line.slice(5).replace(/^ /,''));continue;}
  // This transport has only unnamed data events; do not ignore unknown payload fields.
  bad();
 }
 if(data.length||!done||!finished)bad();return{text,usage};
}
