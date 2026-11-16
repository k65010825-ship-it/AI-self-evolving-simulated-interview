import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';import{existsSync}from'node:fs';import{resolve,join,dirname}from'node:path';import{pathToFileURL}from'node:url';import{createInterface}from'node:readline';import{randomUUID}from'node:crypto';import{z}from'zod';
import{createFieldSession,openFieldSession}from'../apps/agent/src/field/session.ts';import{scoreFieldSession}from'../apps/agent/src/field/score.ts';import{RoleIdSchema}from'../packages/contracts/src/tools.ts';import{FieldParticipantSchema}from'../packages/contracts/src/field-session.ts';
import example from'../apps/agent/src/model-access/qianwen.example.json'with{type:'json'};
const Settings=z.object({participantId:FieldParticipantSchema.shape.participantId,developmentReviewerIds:FieldParticipantSchema.shape.developmentReviewerIds}).strict();
async function json(path:string){if((await stat(path)).size>2*1024*1024)throw Error('FIELD_INPUT_TOO_LARGE');return JSON.parse(await readFile(path,'utf8'))as unknown;}
const write=(path:string,data:unknown)=>writeFile(path,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
export async function agentFieldMain(args:string[]){const [command,rawDir,...rest]=args;if(!rawDir)throw Error('FIELD_ARGUMENTS');const dir=resolve(rawDir),file=join(dir,'study.sqlite');
 if(command==='prepare'&&rest.length===1){const settings=Settings.parse({participantId:rest[0],developmentReviewerIds:[]});await mkdir(dirname(dir),{recursive:true});await mkdir(dir);await write(join(dir,'participant-settings.json'),settings);
  console.log(JSON.stringify({directory:dir,status:'awaiting_participant_consent_and_answers',humanAnswers:0,roles:['java-backend','web-frontend'],questionsPerRole:8,modelCalls:0}));return 0;}
 if(command==='collect'&&rest.length<=1){const role=rest[0]?RoleIdSchema.parse(rest[0]):null;const settings=Settings.parse(await json(join(dir,'participant-settings.json')));
  const rl=createInterface({input:process.stdin,crlfDelay:Infinity}),lines=rl[Symbol.asyncIterator]();let session:ReturnType<typeof openFieldSession>|undefined;
  const next=async(prompt:string)=>{process.stdout.write(prompt);const line=await lines.next();return line.done?null:line.value;};
  try{if(!existsSync(file)){
   console.log('本次仅本机采集文字，题目为草案。请勿输入个人姓名、公司机密或他人隐私。未来score --execute会将答案发送到千问平台；不运行该命令则不上传。供两名队友独立审核，无法认证身份或证明教学效果。');
   if(await next('你是否同意以上本地采集用途？输入“同意”继续，其他输入退出：')!=='同意')return 2;
   session=createFieldSession(file,{...settings,consentRecordId:randomUUID(),consentedAt:Date.now()});
  }else session=openFieldSession(file);
  console.log('每题输入多行；单独输入 /done 提交，/skip 暂跳，/quit 保存退出。提交后不可覆盖；忘记内容可回答“不知道”。不显示量规或模型评分。');
  for(const r of role?[role]:['java-backend','web-frontend']as const){console.log(`\n岗位：${r==='java-backend'?'Java后端':'Web前端'}`);
   for(const q of session.questions(r)){if(q.answered)continue;console.log(`\n[${q.questionType} / 难度${q.difficulty}] ${q.text}`);const parts:string[]=[];
    for(;;){const line=await next('> ');if(line===null||line==='/quit'){console.log(JSON.stringify({...session.status(),status:'paused'}));return 0;}
     if(line==='/skip')break;if(line==='/done'){try{session.submit(r,q.id,parts.join('\n'));console.log('已保存。');break;}catch(e){console.log('尚未保存：回答为空、重复或已提交。请继续补充，或 /skip。');continue;}}
     parts.push(line);if(parts.join('\n').length>10000){parts.length=0;console.log('超过10000字符，已清空当前尚未提交的输入。请重新输入。');}
    }
   }
  }console.log(JSON.stringify({...session.status(),status:'collection_completed_or_skipped'}));return 0;
  }finally{session?.close();rl.close();}
 }
 const session=openFieldSession(file);try{
  if(command==='status'&&rest.length===0){console.log(JSON.stringify({...session.status(),reviews:{java:session.reviewReport('java-backend',[]).status,web:session.reviewReport('web-frontend',[]).status}}));return 0;}
  if(command==='score'&&rest.length===1&&rest[0]==='--execute'){
   console.log('执行上限：每岗8次真实HTTP、声明费用1元；合计16次/2元，无自动重试。费用依据宿主声明费率，不是供应商账单。答案会发送至已配置千问平台。');
   const result=await scoreFieldSession(session,{...example,authorization:{enabled:true,operatorApproved:true,maxRuns:16,expiresAt:Date.now()+600000},outputRepair:'json-fence-only',evidenceGrounding:'unique-excerpt'}, {readCredential:n=>process.env[n]});
   const output=join(dir,`model-report-${randomUUID()}.json`);await write(output,result);console.log(JSON.stringify({report:output,httpAttempts:result.httpAttemptsThisInvocation,qualityVerified:false}));return result.outcomes.every(o=>o.status==='completed')?0:2;
  }
  if(command==='export'&&rest.length===0){if(session.status().humanAnswers!==16)throw Error('FIELD_COMPLETE_COLLECTION_REQUIRED');const root=join(dir,`blind-review-${randomUUID()}`);await mkdir(root);
   for(const role of ['java-backend','web-frontend']as const){const b=session.reviewBundle(role),target=join(root,role);await mkdir(target);
    await write(join(target,'private-manifest.json'),b);await write(join(target,'review-packet.json'),b.reviewPacket);
    for(const reviewer of ['a','b'])await write(join(target,`reviewer-${reviewer}-labels.json`),b.reviewPacket.labelTemplate);
   }console.log(JSON.stringify({output:root,instructions:'每位审核者仅接收review-packet与自己的空白labels，绝不分发private-manifest/数据库/模型报告；分别填写后合并。',status:'awaiting_two_independent_reviewers'}));return 0;
  }
  if(command==='review'&&rest.length===4){const role=RoleIdSchema.parse(rest[0]),a=z.array(z.unknown()).parse(await json(rest[1]!)),b=z.array(z.unknown()).parse(await json(rest[2]!));
   const report=session.reviewReport(role,[...a,...b]);await write(rest[3]!,report);console.log(JSON.stringify({status:report.status,roleId:role,report:resolve(rest[3]!),qualityClaimEligible:false,participantCount:1}));return report.status==='passed'?0:2;
  }
  throw Error('FIELD_ARGUMENTS');
 }finally{session.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.exitCode=await agentFieldMain(process.argv.slice(2));}catch(error){
 const message=error instanceof Error&&/^FIELD_[A-Z_]+$/.test(error.message)?error.message:'FIELD_COMMAND_FAILED';console.error(message);process.exitCode=1;
}}
