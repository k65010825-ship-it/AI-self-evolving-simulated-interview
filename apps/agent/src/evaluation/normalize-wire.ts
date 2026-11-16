/** Narrow transport compatibility. The strict business schema and semantic guards still run afterwards. */
export function normalizeOptionalBindings(value:unknown,criteria:readonly {id:string;verificationGoal?:unknown}[]):{value:unknown;changed:boolean}{
 if(!value||typeof value!=='object'||Array.isArray(value))return {value,changed:false};
 const root=value as Record<string,unknown>;if(!Array.isArray(root.criterionScores))return {value,changed:false};
 let changed=false;
 const scores=root.criterionScores.map((entry:unknown)=>{
  if(!entry||typeof entry!=='object'||Array.isArray(entry))return entry;
  const candidate=entry as Record<string,unknown>,criterion=criteria.find(c=>c.id===candidate.criterionId);
  if(!criterion||candidate.verificationBinding!==null||criterion.verificationGoal&&candidate.score!==null)return entry;
  const {verificationBinding:_omitted,...rest}=candidate;changed=true;return rest;
 });
 return {value:changed?{...root,criterionScores:scores}:value,changed};
}
