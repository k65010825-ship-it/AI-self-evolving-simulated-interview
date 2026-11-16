import { z } from 'zod';
import { SemanticRowSchema,SupportLabelSchema,SemanticMetricSchema, type SemanticRow } from '../../../packages/contracts/src/semantic-evaluation.ts';
import { DeliveryReportSchema } from '../../delivery/report.ts';
import { canonical,contentHash } from '../validation.ts';
import { compileSemanticDataset,loadSemanticDataset } from './dataset.ts';
const count=z.number().int().nonnegative(),rate=z.number().min(0).max(1).nullable();
const labels=SupportLabelSchema.options;
const metric=SemanticMetricSchema;
export const SemanticReportSchema=z.object({version:z.literal(1),suiteId:z.literal('citation-support-draft-v1'),datasetDigest:z.string().regex(/^[a-f0-9]{64}$/),
 evaluatorId:z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),evaluatorMode:z.literal('offline-fixture'),split:z.literal('development'),
 startedAt:z.iso.datetime(),finishedAt:z.iso.datetime(),sourceManifest:DeliveryReportSchema.shape.sourceManifest,sourceStable:z.boolean(),
 rows:z.array(SemanticRowSchema).min(1).max(200),summary:z.object({total:count,completed:count,failed:count,abstained:count}).strict(),analysis:metric,
 roles:z.array(z.object({roleId:z.enum(['java-backend','web-frontend']),analysis:metric}).strict()).length(2),
 status:z.enum(['completed-offline','failed']),comparison:z.literal('draft-label-descriptive'),humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),
 liveModelCalls:z.literal(0),productionPublished:z.literal(false),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type SemanticReport=z.infer<typeof SemanticReportSchema>;
type Sample=ReturnType<typeof compileSemanticDataset>['samples'][number];
export function analyzeSemantic(samples:Sample[],rows:SemanticRow[]){
 const pairs=samples.map(s=>({reference:s.reference.verdict,row:rows.find(r=>r.claimId===s.id)!}));
 const total=pairs.length,completed=pairs.filter(p=>p.row.status==='completed').length,failed=total-completed;
 const abstained=pairs.filter(p=>p.row.status==='completed'&&p.row.verdict==='uncertain').length;
 const correct=pairs.filter(p=>p.row.status==='completed'&&p.row.verdict===p.reference).length;
 const unsupported=pairs.filter(p=>p.reference!=='supported'),judged=unsupported.filter(p=>p.row.status==='completed'&&p.row.verdict!=='uncertain');
 const unsupportedAccepted=judged.filter(p=>p.row.status==='completed'&&p.row.verdict==='supported').length;
 const classes=labels.map(label=>{
  const tp=pairs.filter(p=>p.reference===label&&p.row.status==='completed'&&p.row.verdict===label).length;
  const fp=pairs.filter(p=>p.reference!==label&&p.row.status==='completed'&&p.row.verdict===label).length;
  const fn=pairs.filter(p=>p.reference===label&&!(p.row.status==='completed'&&p.row.verdict===label)).length;
  return{label,tp,fp,fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,f1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null};
 });
 const f1s=classes.map(c=>c.f1).filter(x=>x!==null);
 const confusion=labels.map(reference=>{const ps=pairs.filter(p=>p.reference===reference);const n=(label:string)=>ps.filter(p=>p.row.status==='completed'&&p.row.verdict===label).length;
  return{reference,supported:n('supported'),contradicted:n('contradicted'),insufficient:n('insufficient'),uncertain:n('uncertain'),failed:ps.filter(p=>p.row.status!=='completed').length};});
 return{total,completed,failed,abstained,correct,accuracy:total?correct/total:null,judgmentCoverage:total?(completed-abstained)/total:null,
  unsupportedTotal:unsupported.length,unsupportedJudged:judged.length,unsupportedAccepted,unsupportedAcceptanceRate:judged.length?unsupportedAccepted/judged.length:null,
  unsupportedJudgmentCoverage:unsupported.length?judged.length/unsupported.length:null,classes,macroF1:f1s.length?f1s.reduce((a,b)=>a+b,0)/f1s.length:null,confusion};
}
function invalid():never{throw new Error('SEMANTIC_REPORT_INVALID');}
export function sealSemanticReport(input:Pick<SemanticReport,'evaluatorId'|'startedAt'|'finishedAt'|'sourceManifest'|'sourceStable'|'rows'>){
 const d=compileSemanticDataset(loadSemanticDataset()),analysis=analyzeSemantic(d.samples,input.rows),roles=(['java-backend','web-frontend']as const).map(roleId=>({roleId,analysis:analyzeSemantic(d.samples.filter(s=>s.roleId===roleId),input.rows)}));
 const body={...input,version:1,suiteId:'citation-support-draft-v1',datasetDigest:d.digest,evaluatorMode:'offline-fixture',split:'development',
  summary:{total:analysis.total,completed:analysis.completed,failed:analysis.failed,abstained:analysis.abstained},analysis,roles,
  status:input.sourceStable&&!analysis.failed?'completed-offline':'failed',comparison:'draft-label-descriptive',humanReferenceCount:0,qualityClaimEligible:false,liveModelCalls:0,productionPublished:false};
 return verifySemanticReport({...body,digest:contentHash(body)});
}
export function verifySemanticReport(raw:unknown,currentManifest?:SemanticReport['sourceManifest']):SemanticReport{
 const p=SemanticReportSchema.safeParse(raw);if(!p.success)invalid();const r=p.data,d=compileSemanticDataset(loadSemanticDataset());
 if(r.datasetDigest!==d.digest||Date.parse(r.finishedAt)<Date.parse(r.startedAt)||r.rows.length!==d.samples.length||r.rows.some((row,i)=>row.claimId!==d.samples[i]!.id))invalid();
 const paths=r.sourceManifest.map(f=>f.path);if(new Set(paths).size!==paths.length||canonical(paths)!==canonical([...paths].sort())||currentManifest&&canonical(r.sourceManifest)!==canonical(currentManifest))invalid();
 for(const row of r.rows){if(row.status==='completed'&&row.verdictDigest!==contentHash({verdict:row.verdict}))invalid();
  if(row.status==='cancelled'&&row.error!=='RUN_CANCELLED'||row.status==='timed_out'&&row.error!=='DEADLINE_EXCEEDED'||row.status==='failed'&&['RUN_CANCELLED','DEADLINE_EXCEEDED'].includes(row.error))invalid();}
 const analysis=analyzeSemantic(d.samples,r.rows),roles=(['java-backend','web-frontend']as const).map(roleId=>({roleId,analysis:analyzeSemantic(d.samples.filter(s=>s.roleId===roleId),r.rows)}));
 if(canonical(r.analysis)!==canonical(analysis)||canonical(r.roles)!==canonical(roles)||canonical(r.summary)!==canonical({total:analysis.total,completed:analysis.completed,failed:analysis.failed,abstained:analysis.abstained})
  ||r.status!==(r.sourceStable&&!analysis.failed?'completed-offline':'failed'))invalid();
 const{digest,...body}=r;if(contentHash(body)!==digest)invalid();return r;
}
export function renderSemanticMarkdown(raw:unknown){const r=verifySemanticReport(raw);return['# 引文支持判分：离线草案对照','',
 `执行状态：${r.status}；完成${r.summary.completed}/${r.summary.total}；失败${r.summary.failed}；弃权${r.summary.abstained}。`,
 `与草案一致率：${r.analysis.accuracy}；错误支持率：${r.analysis.unsupportedAcceptanceRate}；负例判断覆盖：${r.analysis.unsupportedJudgmentCoverage}。`,
 '','完成不等于语义达标。全部参考assistant-authored/draft；humanReferenceCount=0，qualityClaimEligible=false。','',
 '| 角色 | 一致率 | 负例错误支持率 | 判断覆盖 |','| --- | --- | --- | --- |',
 ...r.roles.map(x=>`| ${x.roleId} | ${x.analysis.accuracy} | ${x.analysis.unsupportedAcceptanceRate} | ${x.analysis.judgmentCoverage} |`),'',
 '| 草案标签 | 判支持 | 判矛盾 | 判不足 | 弃权 | 失败 |','| --- | --- | --- | --- | --- | --- |',
 ...r.analysis.confusion.map(x=>`| ${x.reference} | ${x.supported} | ${x.contradicted} | ${x.insufficient} | ${x.uncertain} | ${x.failed} |`),'',
 '判断覆盖=(完成-弃权)/全部案例；失败/弃权计入总分母。错误支持率只对已给明确判断的草案负例计算，必须同时看负例覆盖；无判断时为null。',
 '宏F1按有定义的三类F1平均；引用偏移合法不等于判分语义正确。SHA校验不是签名、人工批准或执行认证。','',`摘要：${r.digest}`,''].join('\n');}

