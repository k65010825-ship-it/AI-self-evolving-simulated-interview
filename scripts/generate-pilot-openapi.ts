import {writeFile} from 'node:fs/promises';import {z} from 'zod';import {stringify} from 'yaml';
import * as workbench from '../packages/contracts/src/workbench.ts';
import * as fieldSession from '../packages/contracts/src/field-session.ts';
import * as accounting from '../packages/contracts/src/session-accounting.ts';
import * as expression from '../packages/contracts/src/expression-assessment.ts';
import * as tts from '../packages/contracts/src/tts.ts';import * as field from '../packages/contracts/src/field-evidence.ts';
const schemas:Record<string,unknown>={};
for(const [moduleName,exports] of Object.entries({workbench,accounting,expression,tts,field,fieldSession})){
 const output:Record<string,unknown>={version:1};for(const [key,value] of Object.entries(exports))if(key.endsWith('Schema')&&value instanceof z.ZodType){
  const name=key.slice(0,-6),schema=z.toJSONSchema(value,{io:'input'});output[name]=schema;if(moduleName==='workbench')schemas[name]=schema;
 }await writeFile(new URL(`../docs/${moduleName}-schemas.json`,import.meta.url),JSON.stringify(output,null,2)+'\n');
}
schemas.Problem={type:'object',required:['code','status','detail'],properties:{code:{type:'string'},status:{type:'integer'},detail:{type:'string'}}};
const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});const json=(name:string)=>({'application/json':{schema:ref(name)}});
const error={description:'结构化公开错误；不会返回供应商原文或凭证。',content:{'application/problem+json':{schema:ref('Problem')}}};
const id=(name:string)=>({name,in:'path',required:true,schema:{type:'string',minLength:1}});
const op=(operationId:string,summary:string,status=200,input?:string,output?:string,parameters:unknown[]=[])=>({operationId,summary,security:[{BearerAuth:[]}],parameters,
 ...(input?{requestBody:{required:true,content:json(input)}}:{}),responses:{[status]:{description:status===202?'已受理；须轮询operation，不表示正式完成。':'已实现的试点响应。',...(output?{content:json(output)}:{})},'400':error,'401':error,'403':error,'409':error,'429':error,'503':error}});
const sid=[id('id')];const paths:Record<string,unknown>={
 '/health':{get:{...op('health','入口能力状态'),security:[]}},
 '/v1/auth/login':{post:{...op('login','运营者配置的学生账号登录',200,'PilotLogin'),security:[]}},
 '/v1/auth/logout':{post:op('logout','撤销当前令牌')},
 '/v1/roles':{get:op('roles','两个岗位清单',200,undefined,'PilotRoles')},
 '/v1/interviews':{get:op('sessions','当前学生最近100场记录'),post:op('create','幂等创建面试',202,'PilotSessionCreate')},
 '/v1/interviews/{id}':{get:op('session','读取本人会话与报告',200,undefined,'PilotSessionView',sid)},
 '/v1/interviews/{id}/question':{post:op('question','规划并生成下一题',202,'PilotCommand',undefined,sid)},
 '/v1/interviews/{id}/answers':{post:op('answer','提交文字或确认后的语音答案',202,'PilotAnswer',undefined,sid)},
 '/v1/interviews/{id}/completion':{post:op('complete','收尾报告并提交跨会话记忆',202,'PilotCommand',undefined,sid)},
 '/v1/operations/{id}':{get:op('operation','查询正式操作结果',200,undefined,'PilotOperationView',sid)},
 '/v1/interviews/{id}/speech':{post:op('speechCreate','登记WAV哈希与题目版本',201,'PilotSpeechCreate',undefined,sid)},
 '/v1/speech/{id}':{get:op('speechGet','查询转写与表达观察',200,undefined,'PilotSpeechView',sid)},
 '/v1/speech/{id}/audio':{put:{...op('speechUpload','上传16kHz单声道PCM16 WAV',202,undefined,'PilotSpeechView',sid),requestBody:{required:true,content:{'audio/wav':{schema:{type:'string',format:'binary',maxLength:4194304}}}}}},
 '/v1/speech/{id}/confirmation':{post:op('speechConfirm','确认转写，仅修改文本',200,'PilotSpeechConfirm','PilotSpeechView',sid)},
 '/v1/speech/{id}/cancellation':{post:op('speechCancel','取消语音候选，保留费用不明记录',202,undefined,'PilotSpeechView',sid)},
 '/v1/interviews/{id}/question-audio':{get:{...op('questionAudio','播报当前正式题目',200,undefined,undefined,[...sid,{name:'questionId',in:'query',required:true,schema:{type:'string'}}]),responses:{'200':{description:'24kHz单声道PCM16 WAV；离线模式为提示音。',content:{'audio/wav':{schema:{type:'string',format:'binary'}}}},'401':error,'403':error,'409':error,'429':error,'503':error}}},
 '/v1/evidence/status':{get:op('evidenceStatus','独立审核与真实队列的初始待验证状态')},
};
await writeFile(new URL('../docs/openapi.yaml',import.meta.url),stringify({openapi:'3.1.0',info:{title:'Interview Workbench Pilot API',version:'0.2.0',description:'pilot:start 的可运行SQLite试点接口。dev:api仍为scaffold；未列出的学习/实验发布等接口返回501。时间为epoch毫秒；命令使用body operationId和expectedRevision。',license:{name:'Private project; licensing not yet declared'}},servers:[{url:'http://127.0.0.1:3100',description:'本地试点；远程部署需要HTTPS反向代理'}],paths,components:{securitySchemes:{BearerAuth:{type:'http',scheme:'bearer',description:'登录得到的随机不透明令牌，1小时有效，仅主进程内存保存。'}},schemas}}));
