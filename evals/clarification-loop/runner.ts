import {conditionScopeScenario} from '../../experiments/verification-binding/condition-fixture.ts';
import {observationScenario} from '../../experiments/verification-binding/observation-fixture.ts';
import {TurnInputSchema} from '../../packages/contracts/src/evaluation.ts';
import type {UnscoredTurn} from '../../packages/contracts/src/clarification.ts';
import {evaluateTurnWithClarification,validateClarificationReceipt} from '../../apps/agent/src/orchestration/clarify-turn.ts';
import {AgentStateError} from '../../apps/agent/src/planning/interview-state.ts';
import {loopCases,type Step} from './cases.ts';
import {buildLoopReport,projectLoopRow} from './report.ts';
import {collectDeliverySources} from '../delivery/sources.ts';
import {contentHash} from '../answers/validation.ts';
const baseTime=1794096000000;
export async function runClarificationLoop(){
 const before=await collectDeliverySources(process.cwd()),rows=[];
 for(const c of loopCases){
  const f=conditionScopeScenario(c.role,'old');let input=TurnInputSchema.parse(f.input);
  input.state.startedAt=baseTime;input.state.deadlineAt=baseTime+1200000;input.context.deadlineAt=baseTime+60000;
  if(c.scenario==='time-before')input.state.deadlineAt=baseTime+30000;
  const steps:Step[]=[];let previous:UnscoredTurn|undefined,prefix='';
  for(let round=0;round<(c.expected.length);round++){
   const sample=round===0?f:c.scenario==='repaired'||c.scenario==='zero-score'?observationScenario(c.role,c.scenario==='zero-score'?'wrong-value':'valid'):
    conditionScopeScenario(c.role,c.scenario==='semantic-risk'?'known-limit':'old');
   if(round){prefix=input.answer.text+'\n';input={...input,answer:{id:'answer-2',text:prefix+sample.input.answer.text},context:{...input.context,runId:'loop-2',attemptId:'loop-2',deadlineAt:input.state.deadlineAt}};}
   const offset=(p:{evidenceId:string;start:number;end:number})=>({...p,start:p.start+prefix.length,end:p.end+prefix.length});
   const b=sample.binding,binding={...b,action:offset(b.action),target:offset(b.target),expectation:offset(b.expectation),observation:{metric:offset(b.observation.metric),value:offset(b.observation.value),condition:offset(b.observation.condition)}};
   const output={...sample.assessment,evidence:[{id:'unit',start:prefix.length,end:input.answer.text.length,excerpt:sample.input.answer.text}],criterionScores:[{...sample.assessment.criterionScores[0]!,verificationBinding:binding}]};
   const controller=new AbortController();if(c.scenario==='cancel-before')controller.abort();let calls=0;
   try{
    const r=await evaluateTurnWithClarification(input,{now:()=>baseTime+(round&&c.scenario==='time-after'?1160000:round),signal:controller.signal,evaluate:async()=>{calls++;return output;}},
     {...(previous?{previous}:{}),...(c.scenario==='still-missing'?{policy:{maxClarifications:2,minRemainingSeconds:45}}:{})});
    if(r.status==='scored')steps.push({status:r.status,reason:null,template:null,score:r.proposal.evaluation.normalizedScore,observations:r.proposal.nextState.observations.length,evaluatorCalls:calls});
    else{validateClarificationReceipt(input,r);steps.push({status:r.status,reason:r.reason,template:r.clarificationTemplate??null,score:null,observations:input.state.observations.length,evaluatorCalls:calls});previous=r;}
   }catch(error){
    if(c.scenario!=='cancel-before'||!(error instanceof AgentStateError)||error.code!=='RUN_CANCELLED')throw error;
    steps.push({status:'cancelled',reason:null,template:null,score:null,observations:0,evaluatorCalls:calls});
   }
  }
  rows.push(projectLoopRow(c,steps));
 }
 const report=await buildLoopReport(rows);
 if(contentHash(before)!==contentHash(report.sourceManifest))throw Error('CLARIFICATION_LOOP_SOURCE_CHANGED');
 return report;
}
