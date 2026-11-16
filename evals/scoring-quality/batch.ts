import {mkdir,mkdtemp,readFile,writeFile,lstat} from 'node:fs/promises';import {join,resolve} from 'node:path';import {randomBytes} from 'node:crypto';
import {ScoringQualityBatchSchema,ScoringQualityAuthorizationSchema,type ScoringQualityBatch} from '../../packages/contracts/src/scoring-quality.ts';
import {LiveServiceConfigSchema} from '../../packages/contracts/src/live-model.ts';
import example from '../../apps/agent/src/model-access/qianwen.example.json' with {type:'json'};
import {collectDeliverySources} from '../delivery/sources.ts';import {contentHash,canonical} from '../answers/validation.ts';
import {assertLocalAcceptancePath} from '../local-acceptance/batch.ts';import {loadScoringQualityCases,loadScoringContrastCases} from './dataset.ts';
import {loadScoringChallengeCases} from './challenge.ts';
export type ScoringSuite='baseline'|'contrast'|'challenge';
const casesFor=(suite?:ScoringSuite)=>suite==='challenge'?loadScoringChallengeCases():suite==='contrast'?loadScoringContrastCases():loadScoringQualityCases();
type Sources=()=>Promise<{path:string;sha256:string}[]>;
export function scoringQualityConfig(){return LiveServiceConfigSchema.parse({...example,planning:'deterministic',questionDelivery:'canonical',evidenceGrounding:'quoted-spans',outputRepair:'json-fence-only',evaluationResponseFormat:'json_object',verificationExtraction:'candidate-refs',
 profile:{...example.profile,profileId:'scoring-quality-core-v1',limits:{...example.profile.limits,maxCalls:1,maxConcurrent:1,maxInputTokens:12000,maxOutputTokens:4000,maxTotalTokens:16000,maxCostMicros:288000,timeoutMs:30000}},
 authorization:{enabled:false,operatorApproved:false,expiresAt:0,maxRuns:8},recovery:{httpMaxAttempts:1,maxModelRepairs:0,maxOutputRecoveries:0,maxContextCompactions:0,autoCompact:{enabled:false,windowTokens:131072,triggerRatio:.8}}});}
export async function qualityJson(path:string){await assertLocalAcceptancePath(path);const st=await lstat(path);if(!st.isFile()||st.size>4*1024*1024)throw Error('SCORING_QUALITY_FILE_INVALID');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path)));}
export async function qualityWrite(path:string,value:unknown){await assertLocalAcceptancePath(path);await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
export function scoringQualityAuthorization(batch:ScoringQualityBatch,kind:'live'|'injected-test-only',expiresAt:number){return ScoringQualityAuthorizationSchema.parse({version:1,kind,operatorApproved:true,batchId:batch.id,batchDigest:batch.digest,expiresAt,maxRequests:6,maxDeclaredCostMicros:2000000,
 provider:{providerId:'qianwen',modelId:'qwen3.8-max',endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1'},credentialSource:{platform:'qianwen',env:'INTERVIEW_QIANWEN_API_KEY'}});}
export async function prepareScoringQualityBatch(options:{outputRoot?:string;sources?:Sources;suite?:ScoringSuite}={}){
 const sources=options.sources??(()=>collectDeliverySources(process.cwd())),manifest=await sources(),cases=casesFor(options.suite),root=resolve(options.outputRoot??'.cache/scoring-quality');await assertLocalAcceptancePath(root);await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'batch-'));
 const body={version:1 as const,id:randomBytes(12).toString('hex'),directory:output,createdAt:Date.now(),origin:'assistant-authored-development' as const,...(options.suite&&options.suite!=='baseline'?{suite:options.suite}:{}),...(options.suite==='challenge'?{stabilityPolicy:{version:1 as const,runs:2 as const,maxNormalizedDrift:.25 as const}}:{}),cases,sourceManifest:manifest,config:scoringQualityConfig(),maxRequests:6 as const,maxDeclaredCostMicros:2000000 as const,humanReferenceCount:0 as const,qualityClaimEligible:false as const};
 if(canonical(manifest)!==canonical(await sources()))throw Error('SCORING_QUALITY_SOURCE_CHANGED');
 const batch=ScoringQualityBatchSchema.parse({...body,digest:contentHash(body)});await qualityWrite(join(output,'batch.json'),batch);
 await qualityWrite(join(output,'authorization.template.json'),{...scoringQualityAuthorization(batch,'live',0),operatorApproved:false});
 const review=['# 双岗评分质量草案验收批次','',`批次 ${batch.id}；摘要 ${batch.digest}；suite=${batch.suite??'baseline'}`,'',
  '范围：共享评分核心（Pi/量规/澄清/弃评/绑定），不是桌面或本地stdio端到端验收。8个AI合成development样例，独立人工参考0；不发布评分策略。',
  '千问AI平台 qwen3.8-max；https://maas.qianwenaiapi.com/compatible-mode/v1；项目INTERVIEW_QIANWEN_API_KEY，声明来源qianwen。',
  '最多6次HTTP、人民币2元声明费率预算（非厂商账单）；单次30秒/输出4000 tokens，一题最多1次HTTP，无重试/模型修复/额外规划。两个明确不会样例由本地守卫零调用弃评。',
  '验证题启用candidate-refs：宿主从原答/量规抽取有界候选，模型显式选ID并评分；不自动补选择、改值或放宽绑定。普通题仍使用原文引文。',
  'prepare不读取密钥、不联网。执行须本批授权，一次性claim；unknown停止后续调用。评分区间/解释不输入模型，AI区间只能作草案参考；失败不改标签、不覆盖原报告。',
  ...(options.suite==='challenge'?['稳定性假设已冻结：需两批不同执行且输入/源码/配置相同；逐维归一化分差上限0.25。阈值是开发验收策略，不是科学可靠性结论；比较不调用模型。']:[]),
  '',...cases.flatMap(c=>[`## ${c.id}`,c.item.question,'',c.answer,'',`预期行为：${c.expectedOutcome}；区间 ${JSON.stringify(c.reference.bands)}`,c.reference.rationale,''])].join('\n');
 await writeFile(join(output,'review.md'),review+'\n',{flag:'wx'});return{output,batch};
}
export async function readHistoricalScoringQualityBatch(dir:string){const batch=ScoringQualityBatchSchema.parse(await qualityJson(join(resolve(dir),'batch.json'))),{digest,...body}=batch;
 if(batch.directory!==resolve(dir)||contentHash(body)!==digest||new Set(batch.cases.map(c=>c.id)).size!==8)throw Error('SCORING_QUALITY_BATCH_INVALID');return batch;}
export async function readScoringQualityBatch(dir:string,options:{sources?:Sources}={}){const batch=await readHistoricalScoringQualityBatch(dir);
 if(canonical(batch.cases)!==canonical(casesFor(batch.suite))||canonical(batch.config)!==canonical(scoringQualityConfig())||canonical(batch.sourceManifest)!==canonical(await(options.sources??(()=>collectDeliverySources(process.cwd())))()))throw Error('SCORING_QUALITY_BATCH_INVALID');return batch;}
