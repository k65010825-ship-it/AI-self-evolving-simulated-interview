import type{TurnInput}from'../../../../packages/contracts/src/evaluation.ts';
import{AgentStateError}from'../planning/interview-state.ts';
export function validateContentScope(input:TurnInput){
 const behavioral=input.question.questionType==='behavioral';
 if(input.rubric.scope!==(behavioral?'behavioral-content':'technical-content'))throw new AgentStateError('VALIDATION_ERROR');
 // A single mastery estimate must not mix technical and collaboration constructs.
 if([...input.state.priorEvidence,...input.state.observations].some(o=>o.skillId===input.question.skillId&&
   (o.questionType==='behavioral')!==behavioral))throw new AgentStateError('VALIDATION_ERROR');
}
