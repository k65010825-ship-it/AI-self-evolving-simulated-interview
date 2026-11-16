import {RubricSchema} from '../../../../../packages/contracts/src/scoring.ts';
/** Shared generation policy, not a deterministic semantic oracle or authority to change host state. */
export const evidenceDecisionVersion='evidence-decision-v1';
export function evidenceDecisionGuidance(raw:unknown){const rubric=RubricSchema.parse(raw);
 const missing={evidence:[],criterionScores:rubric.criteria.map(c=>({criterionId:c.id,score:null,evidenceIds:[]})),feedback:{strengths:[],improvements:['请补充针对当前问题的具体判断与理由。']}};
 return 'Evidence decision policy: '+evidenceDecisionVersion+'. Apply the following separately to EVERY host criterion. Determine evidence sufficiency BEFORE applying score anchors; anchors grade assessable claims, never turn absent relevant evidence into zero. '
  +'No relevant assessable assertion is UNKNOWN, not an incorrect answer: return score:null and evidenceIds:[]; omit verificationBinding. '
  +'Experience claims, willingness, intentions, generic process descriptions or repeating the question do not establish technical correctness. Do not penalize their absence of technical evidence with zero. '
  +'A substantive, question-relevant incorrect assertion may receive zero, supported by its exact quote. Zero means assessable content contradicts the rubric, not that the candidate has unknown ability. '
  +'A partial relevant correct explanation remains eligible for a positive score under the anchors. An uncertainty phrase inside substantive reasoning does not make the entire answer unknown. Mixed criteria may contain both numeric scores and nulls; never invent evidence to fill a missing criterion. '
  +'The host alone decides clarification and abstention, remaining time, retry limits and state updates. Do not output a workflow decision, refusal envelope or standalone clarification. '
  +'The ONLY allowed root keys are evidence, criterionScores, feedback. Do NOT add status, reason, confidence, clarification, decision or other root keys. Express missing support inside criterionScores, and suggestions inside feedback.improvements. '
  +'When EVERY criterion lacks support, use this complete rubric-specific missing-evidence FORMAT (not a default verdict; judge the actual answer, never copy unsupported evidence): '+JSON.stringify(missing)+'.\n';
}
