import { pathToFileURL } from 'node:url';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runWorkflowDeliveryDemo } from './demo-workflow-delivery.ts';
import { createQuestionPresentation,resumeQuestionPresentation,requireQuestionAcknowledged } from '../packages/agent-client/src/question-ack.ts';
import { createQuestionAckFixtureStore } from '../experiments/commit/question-ack-store.ts';
import { QuestionPresentationRecordSchema,type QuestionPresentationRecord } from '../packages/contracts/src/question-ack.ts';
import { workflowCommitDigest as digest } from '../packages/agent-client/src/workflow-commit.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';

/** Scripted client acknowledgements, not Electron rendering or formal API/database verification. */
export async function runQuestionAcknowledgementDemo(roleId:RoleId='java-backend',options:{transport?:'in-process'|'tcp';persistRoundTrip?:(record:QuestionPresentationRecord)=>Promise<unknown>}={}){
 const confirmations:{questionId:string;exactReplay:boolean;packetStable:boolean;confirmationSource:'client-reported'}[]=[];
 const roundTrip=async(record:QuestionPresentationRecord)=>{
  const restored=QuestionPresentationRecordSchema.parse(options.persistRoundTrip?await options.persistRoundTrip(record):JSON.parse(JSON.stringify(record)));
  if(digest(record)!==digest(restored))throw Error('ACK_ROUNDTRIP_CHANGED');return restored;
 };
 const workflow=await runWorkflowDeliveryDemo(roleId,{transport:options.transport??'in-process',onQuestionAppliedInFixture:async(stored,commitReceipt)=>{
  const identity=stored.workflow.identity,now=Date.now();
  const record=createQuestionPresentation({identity,stored,commitReceipt,deliveryId:`display-${roleId}-${confirmations.length}`,now});
  const pending=await roundTrip(record),resume=resumeQuestionPresentation({identity,stored,record:pending,now:Date.now()});
  if(resume.status!=='awaiting-ack')throw Error('ACK_PENDING_EXPECTED');
  // Simulated renderer only: a real client must send this AFTER rendering the packet.
  const packet=resume.packet,command={deliveryId:packet.deliveryId,sessionId:packet.sessionId,questionId:packet.questionId,textDigest:packet.textDigest,
   commandId:`ack-${confirmations.length}`,clientInstanceId:'scripted-window'};
  const store=createQuestionAckFixtureStore(pending,()=>stored);store.apply(store.prepare(command,Date.now()),Date.now());
  const confirmed=await roundTrip(store.current()),restored=createQuestionAckFixtureStore(confirmed,()=>stored);
  const replay=restored.apply(restored.prepare(command,Date.now()),Date.now());
  const ready=resumeQuestionPresentation({identity,stored,record:restored.current(),now:Date.now()});
  requireQuestionAcknowledged({identity,stored,record:restored.current(),now:Date.now()});
  confirmations.push({questionId:packet.questionId,packetStable:digest(ready.packet)===digest(packet),exactReplay:replay.effect==='replayed-in-memory',confirmationSource:replay.receipt.confirmationSource});
 }});
 return{workflow,confirmedQuestions:confirmations.length,confirmations,scope:'scripted-client-api-cas-fixture',formalCommitted:false as const,
  actualGuiVerified:false as const,productionRestartRecovery:false as const,liveModelCalls:0 as const};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const dir=join(process.cwd(),'.cache','question-ack-demo');await mkdir(dir,{recursive:true});
 for(const role of ['java-backend','web-frontend'] as const){const file=join(dir,role+'.json');
  const r=await runQuestionAcknowledgementDemo(role,{transport:process.argv.includes('--tcp')?'tcp':'in-process',persistRoundTrip:async record=>{
   await writeFile(file,JSON.stringify(record,null,2)+'\n');return JSON.parse(await readFile(file,'utf8'));}});
  console.log(JSON.stringify({role,phase:r.workflow.session.phase,confirmedQuestions:r.confirmedQuestions,confirmations:r.confirmations,
   transport:r.workflow.transport,snapshot:file,scope:r.scope,formalCommitted:r.formalCommitted,actualGuiVerified:r.actualGuiVerified,liveModelCalls:r.liveModelCalls}));
 }
}
