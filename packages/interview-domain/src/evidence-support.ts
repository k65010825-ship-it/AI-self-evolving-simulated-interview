/** Bounded negative checks, not a semantic entailment or correctness oracle.
 * A null rejection means only that these known counterexamples were not found.
 */
export type EvidenceSupportRejection = 'no-substantive-answer'|'risk-only-verification'|'advice-only-ownership'|'verification-binding-missing'|'verification-action-absent'|'verification-target-mismatch'|'verification-observation-mismatch'|'verification-observation-detail-missing'|'verification-observation-value-invalid'|'verification-observation-context-mismatch';
const explicitNonAnswers = new Set([
 '不知道','我不知道','不清楚','我不清楚','不太清楚','暂时不清楚','暂时不知道','暂时不会',
 '不懂','我不懂','不了解','没学过','没有学过','暂无回答','不知道怎么回答',
 '抱歉这个问题我暂时不清楚','idontknow','idonotknow','idk','notsure','imnotsure',
 'sorryidontknow','imnotsurehowtoanswerthis',
]);
// English words need boundaries: latest is not test, brisk is not risk.
const adviceSignal = /(?:建议|应该|应当|需要|要加|容易|可能|风险|方便|上报|埋点|排查|监控|日志|\b(?:recommend(?:s|ed|ing|ation|ations)?|should|might|risks?|logging)\b)/i;
const verificationSignal = /(?:测试|验证|断言|复现|检查|核对|对照|模拟|注入|压测|观察到|测得|期望|预期|证明|\b(?:test(?:s|ed|ing)?|assert(?:s|ed|ing|ion|ions)?|verify|verifies|verified|verifying|verification|expect(?:s|ed|ing|ation|ations)?)\b|[=＝]\s*\d)/i;
const ownershipSignal = /(?:(?:我|本人)(?:会|将|具体|主要|实际|亲自)?(?:负责|修改|实现|设计|编写|增加|补充|修复|定位|拆分)|假设|假想|hypothetical|\bi\s+(?:would\s+|will\s+)?(?:implemented|changed|designed|added|fixed|implement|change|design|add|fix)\b)/i;
export function isExplicitNonAnswer(text: string): boolean {
 const normalized = text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s\u200B-\u200D\uFEFF]/gu,'');
 // Match whole phrases; uncertainty inside a substantive answer is not discarded.
 return !text.trim() || (normalized.length <= 80 && explicitNonAnswers.has(normalized));
}
export function evidenceSupportRejection(
 criterion: {dimension?: string|undefined;verificationGoal?:unknown}, quotes: readonly string[], answerText?: string,
): EvidenceSupportRejection|null {
 if ((answerText !== undefined && isExplicitNonAnswer(answerText)) ||
     (quotes.length > 0 && quotes.every(isExplicitNonAnswer))) return 'no-substantive-answer';
 const text = quotes.filter(q => !isExplicitNonAnswer(q)).join('\n');
 // Only reject known risk/advice-only evidence. Other wording remains unverified.
 const advice = adviceSignal.test(text);
 if (criterion.dimension === 'verification' && !criterion.verificationGoal && advice && !verificationSignal.test(text)) return 'risk-only-verification';
 if (criterion.dimension === 'ownership' && advice && !ownershipSignal.test(text)) return 'advice-only-ownership';
 return null;
}
