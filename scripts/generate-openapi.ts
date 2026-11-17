import {LocalAnswerPageSchema,LocalReportViewSchema} from '../packages/contracts/src/local-presentation.ts';
import {HintRequestSchema,HintStatusInputSchema,HintStatusSchema,HintReceiptSchema,HintJournalSchema} from '../packages/contracts/src/hints.ts';
import { writeFile } from 'node:fs/promises';
import { stringify } from 'yaml';
import { z } from 'zod';
import {LocalRequestSchema,LocalResponseSchema,LocalNotificationSchema,LocalSessionViewSchema,LocalJobViewSchema,LocalCommandSchemas,LocalReadPageSchema} from '../packages/contracts/src/local-runtime.ts';
import {LocalAcceptanceBatchSchema,LocalAcceptanceAuthorizationSchema} from '../packages/contracts/src/local-acceptance.ts';
import {ScoringQualityBatchSchema,ScoringQualityAuthorizationSchema,ScoringQualityReportSchema} from '../packages/contracts/src/scoring-quality.ts';
import {ScoringStabilityComparisonSchema} from '../packages/contracts/src/scoring-stability.ts';
import {VerificationCandidateCatalogSchema} from '../packages/contracts/src/verification-candidates.ts';
import {CandidateEvaluationSchema} from '../apps/agent/src/evaluation/candidate-evaluation.ts';
import {LocalSpeechPolicySchema,LocalSpeechGrantInputSchema,LocalSpeechGrantSchema} from '../packages/contracts/src/local-speech.ts';
import {LocalSpeechCommandSchemas,LocalSpeechTaskSchema,LocalSpeechTaskViewSchema,LocalSpeechAudioChunkSchema} from '../packages/contracts/src/local-speech-api.ts';
import {LocalLiveGrantInputSchema,LocalLiveReconciliationSchema,LocalSessionBudgetSchema} from '../packages/contracts/src/local-live.ts';
import {LocalCredentialRequestSchema,LocalCredentialResponseSchema,LocalCredentialCancelSchema} from '../packages/contracts/src/local-credential.ts';
import { KnowledgeQuerySchema, ToolReceiptSchema } from '../packages/contracts/src/tools.ts';
import { ScoringInputSchema, ScoringReceiptSchema } from '../packages/contracts/src/scoring.ts';
import { TurnInputSchema, EvaluationOutputSchema, TurnProposalSchema } from '../packages/contracts/src/evaluation.ts';
import {FeedbackPublicationSchema,FeedbackReviewCommandSchema,FeedbackReviewReceiptSchema,FeedbackPublicationRevisionContextSchema} from '../packages/contracts/src/feedback-publication.ts';
import {FeedbackRevisionCommandSchema,FeedbackRevisionRecordSchema,FeedbackRevisionHistorySchema} from '../packages/contracts/src/feedback-revision.ts';
import {CloseoutPreviewInputSchema,CloseoutPreviewSchema} from '../packages/contracts/src/closeout-preview.ts';
import { ClarificationPolicySchema,ClarificationOptionsSchema,UnscoredTurnSchema,TurnResolutionSchema } from '../packages/contracts/src/clarification.ts';
import { QuestionSelectionInputSchema, QuestionSelectionSchema } from '../packages/contracts/src/question-selection.ts';
import { ReportInputSchema, ContentReportSchema, ResourceEnrichmentSchema } from '../packages/contracts/src/report.ts';
import { ResourceQuerySchema, ResourceReceiptSchema } from '../packages/contracts/src/resources.ts';
import { MemorySnapshotSchema,AppendMemorySchema,StartSessionMemorySchema,RecallMemorySchema,MemoryRecallSchema } from '../packages/contracts/src/memory.ts';
import{ReflectionInputSchema,ReflectionSchema,PolicyEvaluationInputSchema,PolicyEvaluationSchema}from'../packages/contracts/src/reflection.ts';
import{ExperimentRegistrySchema,ExperimentOperationSchema,SessionPolicyPinSchema}from'../packages/contracts/src/experiment.ts';
import{LearningProgressSchema,RecordLearningEventSchema,PredictionSchema,PairRetestSchema,PerformancePairSchema,
 CalibrationInputSchema,CalibrationSummarySchema}from'../packages/contracts/src/learning.ts';
import{PracticeGoalsRequestSchema,PracticeGoalsSchema,PlanRetestSchema,RetestPlanSchema}from'../packages/contracts/src/learning-planning.ts';
import{AsrOutputSchema,AudioFeaturesSchema,SpeechExpressionSchema,SpeechTranscriptSchema,ConfirmSpeechSchema,SpeechAnswerSchema}from'../packages/contracts/src/speech.ts';
import{PlannerInputSchema,PlannerQuerySchema,PlannerChoiceSchema,PlannerResultSchema}from'../packages/contracts/src/knowledge-planner.ts';
import{CreateWorkflowSchema,WorkflowSchema,PlanQuestionCommandSchema,SubmitWorkflowAnswerSchema,FinishWorkflowSchema,CloseoutSchema,IssuedQuestionRecordSchema,IssuedQuestionContentSchema}from'../packages/contracts/src/session-workflow.ts';
import{WorkflowRsiInputSchema,WorkflowRsiResultSchema}from'../packages/contracts/src/workflow-rsi.ts';
import{KnowledgeSourceSchema,KnowledgeDossierSchema,KnowledgeReviewSchema,KnowledgeWorkspaceSchema}from'../packages/contracts/src/knowledge-curation.ts';
import{AnswerBundleSchema,AnswerReportSchema,AnswerRowSchema}from'../packages/contracts/src/answer-benchmark.ts';
import{SemanticDatasetSchema,SemanticRequestSchema,SemanticVerdictSchema,SemanticRowSchema}from'../packages/contracts/src/semantic-evaluation.ts';
import{SemanticReportSchema}from'../evals/answers/semantic/report.ts';
import{SemanticReviewOperationSchema,SemanticReviewLedgerSchema}from'../packages/contracts/src/semantic-review.ts';
import{SemanticComparisonSchema}from'../packages/contracts/src/semantic-comparison.ts';
import{HistoryCompatibilityPolicySchema,HistoryCompatibilityAuditSchema}from'../packages/contracts/src/history-compatibility.ts';
import{ScoringPayloadSchema,ScoringModelInputSchema}from'../packages/contracts/src/scoring-input.ts';
import{ModelAccessProfileSchema,ModelPreflightSchema,ModelBudgetSnapshotSchema,ModelUsageSchema}from'../packages/contracts/src/model-access.ts';
import{LiveServiceConfigSchema}from'../packages/contracts/src/live-model.ts';
import{EvaluationDiagnosticSchema,OutputRepairPolicySchema,EvidenceGroundingPolicySchema}from'../packages/contracts/src/evaluation-diagnostic.ts';
import{QuestionDeliveryInputSchema,BridgeGenerationRequestSchema,BridgeModelOutputSchema,QuestionDeliverySchema}from'../packages/contracts/src/question-delivery.ts';
import{WorkflowCommitTicketSchema,WorkflowCommitCurrentSchema,WorkflowCommitReceiptSchema,WorkflowCommitDecisionSchema}from'../packages/contracts/src/workflow-commit.ts';
const problemRef = { $ref: '#/components/responses/Problem' };
const speechTasks=await import('../packages/contracts/src/speech-task.ts');
await writeFile(new URL('../docs/speech-task-schemas.json',import.meta.url),JSON.stringify({version:1,
 create:z.toJSONSchema(speechTasks.SpeechTaskCreateSchema),owner:z.toJSONSchema(speechTasks.SpeechOwnerSchema),confirmation:z.toJSONSchema(speechTasks.SpeechTaskConfirmationSchema),
 snapshot:z.toJSONSchema(speechTasks.SpeechTaskSnapshotSchema)},null,2)+'\n');
const asr=await import('../packages/contracts/src/asr-service.ts');
await writeFile(new URL('../docs/asr-service-schemas.json',import.meta.url),JSON.stringify({version:1,
 config:z.toJSONSchema(asr.AsrServiceConfigSchema),accounting:z.toJSONSchema(asr.AsrAccountingSchema)},null,2)+'\n');
const durable=await import('../packages/contracts/src/durable-runtime.ts');
await writeFile(new URL('../docs/durable-runtime-schemas.json',import.meta.url),JSON.stringify({version:1,
 task:z.toJSONSchema(durable.DurableTaskSchema),accounting:z.toJSONSchema(durable.DurableAccountingSchema),
 reconciliation:z.toJSONSchema(durable.BudgetReconciliationSchema),receipt:z.toJSONSchema(durable.BudgetReconciliationReceiptSchema)},null,2)+'\n');
const recovery = await import('../packages/contracts/src/model-recovery.ts');
await writeFile(new URL('../docs/model-recovery-schemas.json',import.meta.url),JSON.stringify({version:1,
 policy:z.toJSONSchema(recovery.ModelRecoveryPolicySchema),event:z.toJSONSchema(recovery.ModelRecoveryEventSchema)},null,2)+'\n');
const ack = await import('../packages/contracts/src/question-ack.ts');
await writeFile(new URL('../docs/question-ack-schemas.json',import.meta.url),JSON.stringify({version:1,
 packet:z.toJSONSchema(ack.QuestionPresentationPacketSchema),command:z.toJSONSchema(ack.QuestionAckCommandSchema),receipt:z.toJSONSchema(ack.QuestionAckReceiptSchema),
 record:z.toJSONSchema(ack.QuestionPresentationRecordSchema),decision:z.toJSONSchema(ack.QuestionAckDecisionSchema),errorCode:z.toJSONSchema(ack.QuestionAckErrorCodeSchema)},null,2)+'\n');
await writeFile(new URL('../docs/question-delivery-schemas.json',import.meta.url),JSON.stringify({version:1,input:z.toJSONSchema(QuestionDeliveryInputSchema),
 modelInput:z.toJSONSchema(BridgeGenerationRequestSchema),modelOutput:z.toJSONSchema(BridgeModelOutputSchema),result:z.toJSONSchema(QuestionDeliverySchema)},null,2)+'\n');
await writeFile(new URL('../docs/workflow-commit-schemas.json', import.meta.url), JSON.stringify({ version: 1,
  ticket: z.toJSONSchema(WorkflowCommitTicketSchema), current: z.toJSONSchema(WorkflowCommitCurrentSchema),
  receipt: z.toJSONSchema(WorkflowCommitReceiptSchema), decision: z.toJSONSchema(WorkflowCommitDecisionSchema),
}, null, 2) + '\n');
await writeFile(new URL('../docs/model-access-schemas.json', import.meta.url), JSON.stringify({ version: 1,
  profile: z.toJSONSchema(ModelAccessProfileSchema), preflight: z.toJSONSchema(ModelPreflightSchema),
  liveServiceConfig:z.toJSONSchema(LiveServiceConfigSchema),
  evaluationDiagnostic:z.toJSONSchema(EvaluationDiagnosticSchema),outputRepairPolicy:z.toJSONSchema(OutputRepairPolicySchema),
  evidenceGroundingPolicy:z.toJSONSchema(EvidenceGroundingPolicySchema),
  snapshot: z.toJSONSchema(ModelBudgetSnapshotSchema), usage: z.toJSONSchema(ModelUsageSchema),
}, null, 2) + '\n');
await writeFile(new URL('../docs/answer-benchmark-schemas.json', import.meta.url), JSON.stringify({ version: 1,
  bundle: z.toJSONSchema(AnswerBundleSchema), row: z.toJSONSchema(AnswerRowSchema), report: z.toJSONSchema(AnswerReportSchema),
  semanticDataset:z.toJSONSchema(SemanticDatasetSchema),semanticRequest:z.toJSONSchema(SemanticRequestSchema),
  semanticVerdict:z.toJSONSchema(SemanticVerdictSchema),semanticRow:z.toJSONSchema(SemanticRowSchema),semanticReport:z.toJSONSchema(SemanticReportSchema),
  semanticReviewOperation:z.toJSONSchema(SemanticReviewOperationSchema),semanticReviewLedger:z.toJSONSchema(SemanticReviewLedgerSchema),
  semanticComparison:z.toJSONSchema(SemanticComparisonSchema),
}, null, 2) + '\n');
await writeFile(new URL('../docs/knowledge-curation-schemas.json', import.meta.url), JSON.stringify({ version: 1,
  source: z.toJSONSchema(KnowledgeSourceSchema), dossier: z.toJSONSchema(KnowledgeDossierSchema),
  review: z.toJSONSchema(KnowledgeReviewSchema), workspace: z.toJSONSchema(KnowledgeWorkspaceSchema),
}, null, 2) + '\n');
const planned = (operationId: string, summary: string, targetStatus: number, parameters: unknown[] = []) => ({
  operationId, summary, description: '设计契约。当前骨架返回 501；目标状态由 x-target-status 记录，不代表已实现。',
  'x-implementation': 'planned', 'x-target-status': targetStatus,
  security: [{ BearerAuth: [] }], parameters,
  responses: { [String(targetStatus)]: { description: '目标成功响应；尚未实现，当前骨架实际返回 501。' },
    '501': problemRef, '401': problemRef, '403': problemRef, '422': problemRef, '429': problemRef },
});
const id = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string', minLength: 1 } });
const pagination = [{ name: 'cursor', in: 'query', schema: { type: 'string' } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }];
const paths: Record<string, unknown> = {
  '/health': { get: { operationId: 'getHealth', summary: '读取骨架健康状态', security: [],
    responses: { '200': { description: '当前仅 scaffold，模型未配置。', content: { 'application/json': {
      schema: { $ref: '#/components/schemas/Health' } } } }, '500': problemRef } } },
  '/v1/roles': { get: planned('listRoles', '岗位清单', 200, pagination) },
  '/v1/interviews': {
    get: planned('listInterviews', '当前用户面试记录', 200, pagination),
    post: { ...planned('createInterview', '创建面试', 201), requestBody: { required: true,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: false,
        required: ['roleId', 'goal', 'durationMinutes'], properties: {
          roleId: { type: 'string', enum: ['java-backend', 'web-frontend'] }, goal: { type: 'string', minLength: 1, maxLength: 500 },
          durationMinutes: { type: 'integer', minimum: 15, maximum: 25 } } } } } } },
  },
  '/v1/interviews/{interviewId}': { get: planned('getInterview', '查询本人面试状态', 200, [id('interviewId')]) },
  '/v1/interviews/{interviewId}/answers': { post: {
    ...planned('submitAnswer', '幂等提交回答', 202, [id('interviewId'),
      { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1, maxLength: 128 } }]),
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false,
      required: ['sessionVersion', 'answer'], properties: { sessionVersion: { type: 'integer', minimum: 0 },
        answer: { type: 'string', minLength: 1, maxLength: 10000 } } } } } },
  } },
  '/v1/interviews/{interviewId}/report': { get: planned('getReport', '读取本人报告', 200, [id('interviewId')]) },
  '/v1/runs/{runId}': { get: planned('getRun', '查询运行快照', 200, [id('runId')]) },
  '/v1/runs/{runId}/events': { get: planned('subscribeRun', '订阅归一 SSE 事件', 200, [id('runId'),
    { name: 'Last-Event-ID', in: 'header', schema: { type: 'string' } }]) },
  '/v1/runs/{runId}/cancellation': { post: planned('cancelRun', '取消运行并撤销提交资格', 202, [id('runId')]) },
  '/v1/profiles/me': { get: planned('getOwnProfile', '本人能力画像', 200) },
  '/v1/experiments': { post: planned('createExperiment', '管理员创建评测任务', 202), get: planned('listExperiments', '管理员评测记录', 200, pagination) },
};
const document = {
  openapi: '3.1.0', info: { title: 'Interview Agent Workbench API', version: '0.1.0',
    description: '仅 /health 已实现。其余为规划契约，当前返回 501；错误码详见 error-handling.md。',
    license: { name: 'Private project; licensing not yet declared' } },
  servers: [{ url: 'http://127.0.0.1:3100', description: '本地开发 API，生产必须 HTTPS' }], paths,
  components: {
    securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer', description: '正式认证尚未实现；会话撤销与归属检查由 API 负责。' } },
    schemas: {
      Health: { type: 'object', additionalProperties: false, required: ['service', 'stage', 'liveModelConfigured', 'capabilities'],
        properties: { service: { type: 'string', enum: ['api', 'agent'] }, stage: { const: 'scaffold' },
          liveModelConfigured: { const: false }, capabilities: { type: 'array', items: { type: 'string' } } } },
      Problem: { type: 'object', required: ['type', 'title', 'status', 'code', 'detail', 'requestId', 'retryable'],
        properties: { type: { type: 'string', format: 'uri' }, title: { type: 'string' }, status: { type: 'integer' },
          code: { type: 'string' }, detail: { type: 'string' }, requestId: { type: 'string' }, retryable: { type: 'boolean' } } },
    },
    responses: { Problem: { description: '结构化公开错误，未实现能力为 NOT_IMPLEMENTED。',
      content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' },
        example: { type: 'urn:interview:error:not-implemented', title: 'NOT_IMPLEMENTED', status: 501,
          code: 'NOT_IMPLEMENTED', detail: '该能力尚未实现，当前为开发骨架。', requestId: 'request-example', retryable: false } } } } },
  },
};
await writeFile(new URL('../docs/openapi.yaml', import.meta.url), stringify(document));
await writeFile(new URL('../docs/tool-schemas.json', import.meta.url), JSON.stringify({
  version: 1, query_role_knowledge: { input: z.toJSONSchema(KnowledgeQuerySchema, { io: 'input' }),
    output: z.toJSONSchema(ToolReceiptSchema) },
  compute_rubric_score: { input: z.toJSONSchema(ScoringInputSchema, { io: 'input' }),
    output: z.toJSONSchema(ScoringReceiptSchema) },
  search_learning_resources: { input: z.toJSONSchema(ResourceQuerySchema, { io: 'input' }), output: z.toJSONSchema(ResourceReceiptSchema) },
}, null, 2) + '\n');
await import('./generate-agent-openapi.ts');
await import('./generate-pilot-openapi.ts');
console.log('Generated docs/openapi.yaml from explicit API design and public Zod contracts.');
await writeFile(new URL('../docs/evaluation-schemas.json', import.meta.url), JSON.stringify({
  version: 1, turnInput: z.toJSONSchema(TurnInputSchema, { io: 'input' }),
    evaluatorOutput: z.toJSONSchema(EvaluationOutputSchema), turnProposal: z.toJSONSchema(TurnProposalSchema),
    feedbackPublication:z.toJSONSchema(FeedbackPublicationSchema),feedbackReviewCommand:z.toJSONSchema(FeedbackReviewCommandSchema),feedbackReviewReceipt:z.toJSONSchema(FeedbackReviewReceiptSchema),
    feedbackPublicationRevisionContext:z.toJSONSchema(FeedbackPublicationRevisionContextSchema),feedbackRevisionCommand:z.toJSONSchema(FeedbackRevisionCommandSchema),
    feedbackRevisionRecord:z.toJSONSchema(FeedbackRevisionRecordSchema),feedbackRevisionHistory:z.toJSONSchema(FeedbackRevisionHistorySchema),
    closeoutPreviewInput:z.toJSONSchema(CloseoutPreviewInputSchema),closeoutPreview:z.toJSONSchema(CloseoutPreviewSchema),
  scoringPayload:z.toJSONSchema(ScoringPayloadSchema),scoringModelInput:z.toJSONSchema(ScoringModelInputSchema),
  clarificationPolicy:z.toJSONSchema(ClarificationPolicySchema),clarificationOptions:z.toJSONSchema(ClarificationOptionsSchema),
  unscoredTurn:z.toJSONSchema(UnscoredTurnSchema),turnResolution:z.toJSONSchema(TurnResolutionSchema),
  selectionInput: z.toJSONSchema(QuestionSelectionInputSchema), selectionOutput: z.toJSONSchema(QuestionSelectionSchema),
  reportInput: z.toJSONSchema(ReportInputSchema), contentReport: z.toJSONSchema(ContentReportSchema),
  resourceEnrichment: z.toJSONSchema(ResourceEnrichmentSchema),
  memorySnapshot:z.toJSONSchema(MemorySnapshotSchema),appendMemory:z.toJSONSchema(AppendMemorySchema),
  startSessionMemory:z.toJSONSchema(StartSessionMemorySchema),
  recallMemory:z.toJSONSchema(RecallMemorySchema),memoryRecall:z.toJSONSchema(MemoryRecallSchema),
  historyCompatibilityPolicy:z.toJSONSchema(HistoryCompatibilityPolicySchema),historyCompatibilityAudit:z.toJSONSchema(HistoryCompatibilityAuditSchema),
  reflectionInput:z.toJSONSchema(ReflectionInputSchema),reflection:z.toJSONSchema(ReflectionSchema),
  policyEvaluationInput:z.toJSONSchema(PolicyEvaluationInputSchema),policyEvaluation:z.toJSONSchema(PolicyEvaluationSchema),
  experimentRegistry:z.toJSONSchema(ExperimentRegistrySchema),experimentOperation:z.toJSONSchema(ExperimentOperationSchema),
  sessionPolicyPin:z.toJSONSchema(SessionPolicyPinSchema),
  learningProgress:z.toJSONSchema(LearningProgressSchema),learningEventRequest:z.toJSONSchema(RecordLearningEventSchema),
  prediction:z.toJSONSchema(PredictionSchema),pairRetestInput:z.toJSONSchema(PairRetestSchema),performancePair:z.toJSONSchema(PerformancePairSchema),
  practiceGoalsRequest:z.toJSONSchema(PracticeGoalsRequestSchema),practiceGoals:z.toJSONSchema(PracticeGoalsSchema),
  planRetest:z.toJSONSchema(PlanRetestSchema),retestPlan:z.toJSONSchema(RetestPlanSchema),
  calibrationInput:z.toJSONSchema(CalibrationInputSchema),calibrationSummary:z.toJSONSchema(CalibrationSummarySchema),
}, null, 2) + '\n');
await writeFile(new URL('../docs/speech-schemas.json',import.meta.url),JSON.stringify({version:1,
  asrOutput:z.toJSONSchema(AsrOutputSchema),audioFeatures:z.toJSONSchema(AudioFeaturesSchema),
  speechExpression:z.toJSONSchema(SpeechExpressionSchema),speechTranscript:z.toJSONSchema(SpeechTranscriptSchema),
  confirmSpeech:z.toJSONSchema(ConfirmSpeechSchema),speechAnswer:z.toJSONSchema(SpeechAnswerSchema),
},null,2)+'\n');
await writeFile('docs/local-runtime-schemas.json',JSON.stringify({hints:{request:z.toJSONSchema(HintRequestSchema),statusInput:z.toJSONSchema(HintStatusInputSchema),status:z.toJSONSchema(HintStatusSchema),receipt:z.toJSONSchema(HintReceiptSchema),journal:z.toJSONSchema(HintJournalSchema)},request:z.toJSONSchema(LocalRequestSchema),response:z.toJSONSchema(LocalResponseSchema),notification:z.toJSONSchema(LocalNotificationSchema),
 readPage:z.toJSONSchema(LocalReadPageSchema),answerPage:z.toJSONSchema(LocalAnswerPageSchema),reportView:z.toJSONSchema(LocalReportViewSchema),sessionView:z.toJSONSchema(LocalSessionViewSchema),jobView:z.toJSONSchema(LocalJobViewSchema),commands:Object.fromEntries(Object.entries(LocalCommandSchemas).map(([key,value])=>[key,z.toJSONSchema(value)])),liveGrant:z.toJSONSchema(LocalLiveGrantInputSchema),liveReconciliation:z.toJSONSchema(LocalLiveReconciliationSchema),sessionBudget:z.toJSONSchema(LocalSessionBudgetSchema),privateCredentialFrames:{request:z.toJSONSchema(LocalCredentialRequestSchema),response:z.toJSONSchema(LocalCredentialResponseSchema),cancel:z.toJSONSchema(LocalCredentialCancelSchema)}},null,2)+'\n');
await writeFile('docs/local-acceptance-schemas.json',JSON.stringify({batch:z.toJSONSchema(LocalAcceptanceBatchSchema),authorization:z.toJSONSchema(LocalAcceptanceAuthorizationSchema)},null,2)+'\n');
await writeFile('docs/scoring-quality-schemas.json',JSON.stringify({batch:z.toJSONSchema(ScoringQualityBatchSchema),authorization:z.toJSONSchema(ScoringQualityAuthorizationSchema),report:z.toJSONSchema(ScoringQualityReportSchema),stability:z.toJSONSchema(ScoringStabilityComparisonSchema),verificationCandidates:z.toJSONSchema(VerificationCandidateCatalogSchema),candidateEvaluation:z.toJSONSchema(CandidateEvaluationSchema)},null,2)+'\n');
await writeFile('docs/local-speech-schemas.json',JSON.stringify({commands:Object.fromEntries(Object.entries(LocalSpeechCommandSchemas).map(([k,v])=>[k,z.toJSONSchema(v)])),policy:z.toJSONSchema(LocalSpeechPolicySchema),grantInput:z.toJSONSchema(LocalSpeechGrantInputSchema),grant:z.toJSONSchema(LocalSpeechGrantSchema),task:z.toJSONSchema(LocalSpeechTaskSchema),taskView:z.toJSONSchema(LocalSpeechTaskViewSchema),audioChunk:z.toJSONSchema(LocalSpeechAudioChunkSchema)},null,2)+'\n');
await writeFile(new URL('../docs/planner-schemas.json',import.meta.url),JSON.stringify({version:1,
 plannerInput:z.toJSONSchema(PlannerInputSchema),plannerQuery:z.toJSONSchema(PlannerQuerySchema,{io:'input'}),
 plannerChoice:z.toJSONSchema(PlannerChoiceSchema),plannerResult:z.toJSONSchema(PlannerResultSchema),
},null,2)+'\n');
await writeFile(new URL('../docs/session-workflow-schemas.json',import.meta.url),JSON.stringify({version:1,
 createWorkflow:z.toJSONSchema(CreateWorkflowSchema,{io:'input'}),workflow:z.toJSONSchema(WorkflowSchema),
  issuedQuestion:z.toJSONSchema(IssuedQuestionRecordSchema),issuedContent:z.toJSONSchema(IssuedQuestionContentSchema),
 planQuestion:z.toJSONSchema(PlanQuestionCommandSchema),submitAnswer:z.toJSONSchema(SubmitWorkflowAnswerSchema),
 finishWorkflow:z.toJSONSchema(FinishWorkflowSchema,{io:'input'}),closeout:z.toJSONSchema(CloseoutSchema),
},null,2)+'\n');
await writeFile(new URL('../docs/workflow-rsi-schemas.json',import.meta.url),JSON.stringify({version:1,
 input:z.toJSONSchema(WorkflowRsiInputSchema,{io:'input'}),result:z.toJSONSchema(WorkflowRsiResultSchema),
},null,2)+'\n');
