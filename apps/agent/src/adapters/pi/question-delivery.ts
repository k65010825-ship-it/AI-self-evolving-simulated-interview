import{z}from'zod';
import type{Api,Model,AssistantMessage}from'@earendil-works/pi-ai';
import{type ModelRuntime,type AgentSession}from'@earendil-works/pi-coding-agent';
import{BridgeGenerationRequestSchema,BridgeModelOutputSchema,type BridgeGenerator}from'../../../../../packages/contracts/src/question-delivery.ts';
import{AgentStateError}from'../../planning/interview-state.ts';
import{createHarnessPiSession}from'./session-factory.ts';
const Options=z.object({cwd:z.string().min(1),timeoutMs:z.number().int().min(1).max(20000).default(8000),
 maxInputCharacters:z.number().int().min(1).max(40000).default(18000),maxOutputCharacters:z.number().int().min(1).max(2000).default(1000)}).strict();
import {harnessSkills} from '../../harness/profiles.ts';
/** Fresh no-tool Pi session. All model/credential/HTTP budget authority comes from the host. */
export function createPiQuestionDelivery(config:{cwd:string;modelRuntime:ModelRuntime;model:Model<Api>;timeoutMs?:number;maxInputCharacters?:number;maxOutputCharacters?:number}):BridgeGenerator{
 const{modelRuntime,model,...raw}=config,p=Options.safeParse(raw);if(!p.success||!modelRuntime||!model)throw new AgentStateError('VALIDATION_ERROR');const o=p.data;
 return async(rawRequest,signal)=>{
  const startedAt=Date.now();
  if(signal.aborted)throw new AgentStateError('RUN_CANCELLED');const parsed=BridgeGenerationRequestSchema.safeParse(rawRequest);
  if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');const system=await harnessSkills.load('delivery');const prompt=JSON.stringify(parsed.data);
  if(system.length+prompt.length>o.maxInputCharacters)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
  const deadline=startedAt+o.timeoutMs;let release:(()=>void)|undefined;
    let session:AgentSession|undefined,unsubscribe:(()=>void)|undefined,closed=false;
  let settled=false,aborted=false,final:AssistantMessage|undefined,characters=0,rejectStop!:(e:AgentStateError)=>void;
  const stop=new Promise<never>((_resolve,reject)=>{rejectStop=reject;});
  const fail=(code:'RUN_CANCELLED'|'DEADLINE_EXCEEDED'|'MODEL_OUTPUT_INVALID')=>{rejectStop(new AgentStateError(code));if(session)void session.abort().catch(()=>{});};
  const onAbort=()=>fail('RUN_CANCELLED');signal.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>fail('DEADLINE_EXCEEDED'),Math.max(0,deadline-Date.now()));
  const check=()=>{if(signal.aborted)throw new AgentStateError('RUN_CANCELLED');if(closed||Date.now()>=deadline)throw new AgentStateError('DEADLINE_EXCEEDED');};
  try{
   const work=(async()=>{
    const created=await createHarnessPiSession({phase:'delivery',cwd:o.cwd,modelRuntime,model,systemPrompt:system,signal,businessScope:{previousAnswerText:parsed.data.previousAnswerText}});
    if(closed||signal.aborted){created.dispose();check();throw new AgentStateError('RUN_CANCELLED');}session=created.session;release=created.dispose;
    if(session.getActiveToolNames().length||session.getCallableToolNames().length)throw new AgentStateError('INTERNAL_ERROR');
    unsubscribe=session.subscribe(event=>{
     if(event.type==='agent_settled'){settled=true;aborted=event.aborted;}
     if(event.type==='message_update'&&event.assistantMessageEvent.type==='text_delta'){
      characters+=event.assistantMessageEvent.delta.length;if(characters>o.maxOutputCharacters)fail('MODEL_OUTPUT_INVALID');}
     if(event.type==='message_end'&&event.message.role==='assistant'){
      final=event.message;if(final.stopReason==='toolUse'||final.content.some(c=>c.type==='toolCall'))fail('MODEL_OUTPUT_INVALID');}
    });
    check();await session.prompt(prompt);await session.waitForIdle();check();
    if(final?.stopReason==='error')throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
    if(!settled||aborted||!final||final.stopReason!=='stop')throw new AgentStateError('MODEL_OUTPUT_INVALID');
    const text=final.content.filter(c=>c.type==='text').map(c=>c.text).join('');
    if(!text||text.length>o.maxOutputCharacters)throw new AgentStateError('MODEL_OUTPUT_INVALID');
    let value:unknown;try{value=JSON.parse(text);}catch{throw new AgentStateError('MODEL_OUTPUT_INVALID');}
    const out=BridgeModelOutputSchema.safeParse(value);if(!out.success)throw new AgentStateError('MODEL_OUTPUT_INVALID');check();return created.gate.accept(()=>out.data);
   })();
   return await Promise.race([work,stop]);
  }catch(e){if(e instanceof AgentStateError)throw e;throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}
  finally{closed=true;clearTimeout(timer);signal.removeEventListener('abort',onAbort);unsubscribe?.();release?.();}
 };
}
