import { z } from 'zod';
import {BindingInvalidDetailSchema,BindingSpanConflictSchema} from './verification-binding.ts';
import {WireCompletionSchema} from './wire-completion.ts';
export const JsonIssueSchema=z.enum(['fence-disabled','fenced-syntax','unclosed-fence','unsupported-fence','surrounding-content','invalid-syntax',
 'unclosed-structure','non-object-root','duplicate-key','generation-incomplete']);
export type JsonIssue=z.infer<typeof JsonIssueSchema>;
export const CandidateIssueSchema=z.enum(['selection-missing','unexpected-selection','unknown-or-wrong-part','observation-mismatch','cross-sentence','binding-guard','evidence-conflict','quote-evidence-invalid','null-evidence','goal-evidence-not-empty']);
export const JsonStructureDetailSchema=z.object({scope:z.enum(['raw','single-json-fence']),root:z.enum(['object','array','string','scalar','empty','unknown']),
 containers:z.enum(['balanced','open','mismatched']),stringState:z.enum(['closed','open','dangling-escape']),openDepth:z.enum(['zero','one','two-plus','unknown']),
 trailing:z.enum(['none','present','unknown'])}).strict();
export type JsonStructureDetail=z.infer<typeof JsonStructureDetailSchema>;
export const QuoteIssueSchema=z.object({part:z.enum(['evidence','action','target','expectation','metric','value','condition']),matches:z.enum(['none','one','multiple'])}).strict();
export const ScoringRejectionSchema=z.enum(['score-input-invalid','score-unknown-criterion','score-dimension-missing','score-dimension-set-mismatch','score-required-missing',
 'score-abstention-evidence','score-out-of-range','score-evidence-required','score-evidence-unknown','score-null-binding','score-binding-invalid']);
export type ScoringRejection=z.infer<typeof ScoringRejectionSchema>;
export const SchemaIssueFieldSchema=z.enum(['root','evidence','evidence.id','evidence.start','evidence.end','evidence.excerpt','evidence.context','evidence.context.before','evidence.context.after',
 'criterionScores','criterionScores.criterionId','criterionScores.score','criterionScores.evidenceIds','criterionScores.verificationBinding',
 'criterionScores.verificationBinding.goalId','criterionScores.verificationBinding.goalVersion','criterionScores.verificationBinding.mode',
 'criterionScores.verificationBinding.span','criterionScores.verificationBinding.span.evidenceId','criterionScores.verificationBinding.span.start','criterionScores.verificationBinding.span.end',
 'criterionScores.verificationBinding.span.context','criterionScores.verificationBinding.span.context.before','criterionScores.verificationBinding.span.context.after',
 'criterionScores.verificationBinding.observation','feedback','feedback.strengths','feedback.improvements','other']);
export const SchemaIssueDetailSchema=z.object({field:SchemaIssueFieldSchema,
 issue:z.enum(['invalid_type','unrecognized_keys','too_small','too_big','invalid_value','other']),
 receivedType:z.enum(['missing','null','string','number','boolean','array','object','other'])}).strict();
/** Internal host diagnostics only. Fixed field categories; no model keys/text, Zod messages, IDs or credentials. */
export const EvaluationDiagnosticSchema=z.object({version:z.literal(1),
 candidateIssue:CandidateIssueSchema.optional(),
 jsonIssue:JsonIssueSchema.optional(),
 jsonShape:JsonStructureDetailSchema.optional(),bindingConflict:BindingSpanConflictSchema.optional(),
 wireCompletion:WireCompletionSchema.optional(),
 quoteIssue:QuoteIssueSchema.optional(),bindingIssue:BindingInvalidDetailSchema.optional(),
 schemaIssue:SchemaIssueDetailSchema.optional(),
 stage:z.enum(['transport','finalization','json','schema','evidence','scoring']),outcome:z.enum(['observed','accepted','rejected','repaired']),
 reason:z.enum([...ScoringRejectionSchema.options,'verification-quotes-grounded','binding-quote-absent','binding-quote-ambiguous','binding-context-mismatch','evidence-context-mismatch','binding-unit-uncited','binding-unit-mismatch',
  'candidate-catalog-built','candidate-selection-grounded','candidate-selection-invalid','json-mode-requested','json-mode-http-rejected','wire-completion-observed','valid','unexpected-tool','completion-incomplete','output-size','provider-failed','invalid-json','invalid-schema',
  'invalid-evidence','evidence-id-duplicate','evidence-offset-out-of-range','evidence-offset-mismatch','evidence-quote-absent','evidence-quote-ambiguous',
  'invalid-score','incomplete-score','json-fence-unwrapped','unique-excerpt-grounded','optional-binding-omitted',
  'no-substantive-answer','risk-only-verification','advice-only-ownership','verification-binding-missing','verification-action-absent','verification-target-mismatch','verification-observation-mismatch','verification-observation-detail-missing','verification-observation-value-invalid','verification-observation-context-mismatch'])}).strict().superRefine((d,ctx)=>{
 if(d.candidateIssue&&(d.stage!=='evidence'||d.outcome!=='rejected'||d.reason!=='candidate-selection-invalid'))ctx.addIssue({code:'custom',message:'Candidate detail must match its fixed rejection.'});
 if(d.jsonShape&&!d.jsonIssue||d.bindingConflict&&d.bindingIssue!==(d.bindingConflict.parts[0]==='metric'?'observation-span-overlap':'span-overlap'))
  ctx.addIssue({code:'custom',message:'Diagnostic detail must match its fixed issue category.'});
 if(d.wireCompletion&&(d.stage!=='transport'||d.outcome!=='observed'||d.reason!=='wire-completion-observed'))ctx.addIssue({code:'custom',message:'Wire facts are observations only.'});
});
export const OutputRepairPolicySchema=z.enum(['none','json-fence-only']);
export const EvidenceGroundingPolicySchema=z.enum(['model-offsets','unique-excerpt','quoted-spans']);
export type EvaluationDiagnostic=z.infer<typeof EvaluationDiagnosticSchema>;
export type EvaluationDiagnosticSink=(event:EvaluationDiagnostic)=>void;
export type OutputRepairPolicy=z.infer<typeof OutputRepairPolicySchema>;
export type EvidenceGroundingPolicy=z.infer<typeof EvidenceGroundingPolicySchema>;
