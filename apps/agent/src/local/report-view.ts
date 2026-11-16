import type {InterviewWorkflow} from '../../../../packages/contracts/src/session-workflow.ts';
import {PilotReportSchema} from '../../../../packages/contracts/src/workbench.ts';
export function localReport(w:InterviewWorkflow){const report=w.closeout?.report;if(!report)return null;
 return PilotReportSchema.parse({evidenceMode:report.evidenceMode,coverage:{totalAnswers:report.coverage.totalAnswers,scoredAnswers:report.coverage.scoredAnswers??report.assessments.length,unscoredAnswers:report.coverage.unscoredAnswers??0},
  skills:report.skills.map(s=>({skillId:s.skillId,label:s.label,mastery:s.mastery,confidence:s.confidence})),
  answers:report.assessments.map(a=>({questionId:a.questionId,questionText:a.presentedText??a.questionText,strengths:a.feedback.strengths,improvements:a.feedback.improvements,
   criteria:a.evaluation.dimensions.map(d=>({id:d.criterionId,label:a.rubric.criteria.find(c=>c.id===d.criterionId)?.description??d.criterionId,score:d.score,maxScore:a.rubric.criteria.find(c=>c.id===d.criterionId)?.maxScore??1,action:a.criterionFeedback?.find(c=>c.criterionId===d.criterionId)?.action??null}))})),
  studyPlan:report.studyPlan.map(p=>({skillId:p.skillId,label:p.label,minutes:p.minutes,actions:p.actions})),unscoredAnswers:(report.unscoredAnswers??[]).map(a=>({questionId:a.questionId,reason:a.reason})),
  warnings:[...report.warnings,report.evidenceMode==='offline-fixture'?'离线固定provider；评分语义未验证':'模型评分候选已过结构校验；评分语义仍需独立审核'],expression:{status:report.expression.status,summary:report.expression.status==='audio_descriptions'?['已确认音频提供语速、停顿等描述性观察；清晰度、自信度和情感未作可靠评分。','音频来源：'+report.expression.speechEvidenceMode]:['没有已确认音频，表达维度未评估。']}});
}
