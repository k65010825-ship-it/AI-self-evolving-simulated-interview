export interface SkillEstimate {
  skillId: string; relevance: number; mastery: number | null; confidence: number; covered: boolean;
}
/** Candidate ranking only; the full state-aware Agent planner is a later iteration. */
export function rankSkills(skills: readonly SkillEstimate[], remainingSeconds: number) {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return [];
  return skills.map((skill) => {
    for (const value of [skill.relevance, skill.confidence, skill.mastery ?? 0.5]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Skill estimates must be within [0, 1].');
    }
    return { ...skill, priority: 0.45 * skill.relevance * (1 - skill.confidence)
      + 0.35 * skill.relevance * (1 - (skill.mastery ?? 0.5)) + 0.2 * (skill.covered ? 0 : 1) };
  }).sort((a, b) => b.priority - a.priority || a.skillId.localeCompare(b.skillId));
}
