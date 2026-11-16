import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import example from '../../apps/agent/src/model-access/qianwen.example.json' with {type:'json'};
import {compileVerificationProposal,loadVerificationProposal} from '../knowledge-verification/proposal.ts';
import {KnowledgeItemSchema} from '../../packages/contracts/src/tools.ts';
import {LiveServiceConfigSchema} from '../../packages/contracts/src/live-model.ts';
import {collectDeliverySources} from '../delivery/sources.ts';
import {canonical,contentHash} from '../answers/validation.ts';
const Sample=z.object({role:z.enum(['java-backend','web-frontend']),item:KnowledgeItemSchema,wrong:z.string(),ambiguous:z.string(),supplement:z.string(),reviewHints:z.array(z.string())}).strict();
const Source=z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const BatchSchema=z.object({version:z.literal(1),id:z.string().regex(/^[a-f0-9]{24}$/),createdAt:z.number().int(),origin:z.literal('assistant-authored-development-draft'),
 samples:z.array(Sample).length(2),sourceManifest:z.array(Source).max(5000),profile:LiveServiceConfigSchema.shape.profile,maxRequests:z.literal(6),maxDeclaredCostMicros:z.literal(2000000),humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type QualityBatch=z.infer<typeof BatchSchema>;
export async function prepareQualityBatch(){
 const p=compileVerificationProposal(loadVerificationProposal('observation')),createdAt=Date.now();
 const samples=p.workspace.items.map(item=>{
  const java=item.roleId==='java-backend';return {role:item.roleId,item,
   wrong:java?'假设我负责单JVM名额计数器。初值99且不归还，我先get检查再set，因此并发申请容量计数器，预期成功数最多100，也不会超额。':'假设我负责列表组件优化。在相同交互下对照测量列表组件，预期actualDuration升高20%，我将耗时升高解释为渲染更快。',
   ambiguous:java?'假设我负责单JVM容量边界，用CAS循环把上限检查和更新放在同一原子边界；这里只论证本地约束。初值99只是旧实验条件。另在未说明条件下并发申请容量计数器，预期成功数最多1。':'假设我负责列表组件优化，我先固定构建和设备，单独核对筛选结果，性能结论仅针对组件子树。相同交互只是旧实验条件。另在未说明条件下对照测量列表组件，预期actualDuration下降20%。',
   supplement:java?'补充本次验证：假设初值99且无归还或重试，同步起跑并发申请容量计数器，预期成功数最多1；同时检查最终计数不超过100，实验不替代并发正确性论证。':'补充本次验证：在相同交互下对照测量列表组件，预期actualDuration下降20%；固定性能构建与设备，重复采样，并独立核对筛选结果，不能外推全站体验。',
   reviewHints:[java?'get后set不能使复合上限判断原子，成功数上限陈述需复核':'把耗时升高解释为更快是待审核错误陈述','条件属于旧实验应保持未知；补充后检查绑定是否指向新段落','以上为AI草案提示，不是独立人工参考，不输入模型请求']};
 });
 const config=LiveServiceConfigSchema.parse({...example,planning:'deterministic',authorization:{enabled:false,operatorApproved:false,expiresAt:0,maxRuns:6},
  profile:{...example.profile,profileId:'typed-quality-batch-v1',limits:{...example.profile.limits,maxCalls:1,maxConcurrent:1,maxInputTokens:12000,maxOutputTokens:4000,maxTotalTokens:16000,maxCostMicros:288000,timeoutMs:30000}},
  recovery:{httpMaxAttempts:1,maxModelRepairs:0,maxOutputRecoveries:0,maxContextCompactions:0}});
 const id=contentHash({createdAt,samples}).slice(0,24),body={version:1 as const,id,createdAt,origin:'assistant-authored-development-draft' as const,samples,
  sourceManifest:await collectDeliverySources(process.cwd()),profile:config.profile,maxRequests:6 as const,maxDeclaredCostMicros:2000000 as const,humanReferenceCount:0 as const,qualityClaimEligible:false as const};
 const batch=BatchSchema.parse({...body,digest:contentHash(body)}),root=join(process.cwd(),'.cache','quality-batch');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 await writeFile(join(output,'batch.json'),JSON.stringify(batch,null,2)+'\n',{flag:'wx'});await writeFile(join(output,'config.example.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
 await writeFile(join(output,'review.md'),['# 双岗位结构化评分与澄清冻结批次','',`批次：${id}；摘要：${batch.digest}`,'',
  '最多6次请求、人民币2元声明费率预算；千问AI平台qwen3.8-max，凭证仅引用INTERVIEW_QIANWEN_API_KEY。配置模板授权关闭，不读取密钥。输出上限4000、单次30秒，无自动重试、模型再次生成或额外规划调用。本地格式策略默认none，可在候选配置显式选择json-fence-only；本地拆围栏不增加请求。',
  '样例与量规均为AI草案development；错误提示不输入模型，人工参考0。旧账/旧unknown不清除，本批次不证明全局账单已对清。','',
  ...samples.flatMap(s=>[`## ${s.role}`,'',s.item.question,'','### 错误陈述控制',s.wrong,'','### 证据不足',s.ambiguous,'','### 只追加的补充',s.supplement,'','### 待审核提示',...s.reviewHints.map(h=>'- '+h),''])].join('\n'),{flag:'wx'});
 return {output,batch,config};
}
export async function readQualityBatch(dir:string){
 const raw=await readFile(join(dir,'batch.json'));if(raw.length>4*1024*1024)throw Error('QUALITY_BATCH_INVALID');
 const b=BatchSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))),{digest,...body}=b;
 if(contentHash(body)!==digest||new Set(b.samples.map(s=>s.role)).size!==2||canonical(b.sourceManifest)!==canonical(await collectDeliverySources(process.cwd())))throw Error('QUALITY_BATCH_INVALID');
 return b;
}
