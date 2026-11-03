import{z}from'zod';
export const ContentScopeSchema=z.enum(['technical-content','behavioral-content']);
export const scopeForQuestionType=(kind:string)=>kind==='behavioral'?'behavioral-content' as const:'technical-content' as const;
export function consistentSkillScopes(items:{skillId:string;questionType:string}[]){
 const scopes=new Map<string,string>();
 for(const item of items){const scope=scopeForQuestionType(item.questionType);
  if(scopes.has(item.skillId)&&scopes.get(item.skillId)!==scope)return false;scopes.set(item.skillId,scope);}
 return true;
}
export const CriterionMetadata={
 dimension:z.enum(['correctness','depth','ownership','logic','communication','relevance','verification']).optional(),
 evidenceRule:z.string().min(1).max(1000).optional(),
 anchors:z.array(z.object({score:z.number().nonnegative().max(100),description:z.string().min(1).max(1000)}).strict()).min(2).max(10).optional(),
};
export function validAnchors(maxScore:number,anchors?:{score:number}[]){
 return !anchors||(anchors[0]?.score===0&&anchors.at(-1)?.score===maxScore&&
  anchors.every((a,i)=>a.score<=maxScore&&(i===0||a.score>anchors[i-1]!.score)));
}
