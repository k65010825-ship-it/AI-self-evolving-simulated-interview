import type { ContentReport } from '../../contracts/src/report.ts';
type Assessment=Pick<ContentReport['assessments'][number],'answerId'|'questionId'|'rubricId'|'rubricVersion'|'rubric'|'evaluation'>;
/** Shared deterministic projection. Callers validate scores and evidence first. No SDK or I/O. */
export function buildCriterionFeedback(a:Assessment):NonNullable<ContentReport['assessments'][number]['criterionFeedback']>{
 return a.rubric.criteria.map(c=>{
  const d=a.evaluation.dimensions.find(d=>d.criterionId===c.id);if(!d)throw new RangeError('INVALID_FEEDBACK_ASSESSMENT');
  const requirement=c.description??c.id,nextAnchor=d.score===null?null:c.anchors?.find(x=>x.score>d.score!)??null;
  const status=d.score===null?'not_scored' as const:d.score===c.maxScore?'scored_strength' as const:'scored_gap' as const;
  const action=status==='not_scored'?`先补充可引用的回答，再按「${requirement}」复评；不要把未评分当成零分。`:
   status==='scored_strength'?`用另一道同技能题验证「${requirement}」能否迁移，保留回答引文后按同一量规复评。`:
   `围绕「${requirement}」完成一道未见过的同技能题，并标注支持该标准的回答原文。${c.evidenceRule?`核对证据规则：${c.evidenceRule}。`:''}${nextAnchor?`对照下一档锚点（${nextAnchor.score}/${c.maxScore}）：${nextAnchor.description}。`:'再按相同量规逐项复评。'}这只是基于当前记录分数的练习目标，不证明原回答缺少特定事实。`;
  return{answerId:a.answerId,questionId:a.questionId,criterionId:c.id,rubricId:a.rubricId,rubricVersion:a.rubricVersion,
   scope:a.rubric.scope,...(c.dimension?{dimension:c.dimension}:{}),requirement,evidenceRule:c.evidenceRule??null,status,score:d.score,maxScore:c.maxScore,
   normalizedScore:d.normalizedScore,priority:d.normalizedScore===null?0:c.weight*(1-d.normalizedScore),evidenceIds:[...d.evidenceIds],nextAnchor:nextAnchor?{...nextAnchor}:null,action,semanticSupport:'not_verified' as const};
 });
}
