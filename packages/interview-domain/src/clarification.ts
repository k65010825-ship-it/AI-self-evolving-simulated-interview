import {NEUTRAL_CLARIFICATION_PROMPT,OBSERVATION_CLARIFICATION_PROMPT,type UnscoredTurn} from '../../contracts/src/clarification.ts';
import type {TurnInput} from '../../contracts/src/evaluation.ts';
import {isExplicitNonAnswer} from './evidence-support.ts';
/** Host rubric/missing IDs select a neutral focus, never a diagnosis of ability or a model-supplied prompt. */
export function observationClarificationEligible(input:TurnInput,missing:readonly string[],answerText=input.answer.text){
 return !isExplicitNonAnswer(answerText)&&missing.length>0&&missing.every(id=>
  input.rubric.criteria.some(c=>c.id===id&&c.dimension==='verification'&&c.verificationGoal?.observationPolicy));
}
/** Legacy versionless receipts keep their original neutral prompt; hashes are not authority. */
export function validClarificationPrompt(input:TurnInput,receipt:UnscoredTurn,answerText=input.answer.text){
 if(receipt.status==='abstained')return receipt.clarification===null&&receipt.clarificationTemplate===undefined;
 if(receipt.clarificationTemplate===undefined)return receipt.clarification===NEUTRAL_CLARIFICATION_PROMPT;
 return receipt.clarificationTemplate==='observation-v1'&&observationClarificationEligible(input,receipt.missingCriterionIds,answerText)
  &&receipt.clarification===OBSERVATION_CLARIFICATION_PROMPT;
}
