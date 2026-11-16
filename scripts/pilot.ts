import {mkdir,readFile,writeFile} from 'node:fs/promises';import {existsSync} from 'node:fs';import {resolve,join} from 'node:path';import {randomBytes} from 'node:crypto';
import {PilotConfigSchema,readPilotConfig} from '../apps/pilot/config.ts';import {createPilotAgent} from '../apps/pilot/agent.ts';import {createPilotApi} from '../apps/pilot/api.ts';
import modelExample from '../apps/agent/src/model-access/qianwen.example.json' with {type:'json'};
const configFile=resolve('.cache/pilot/config.local.json'),root=resolve('.cache/pilot');
async function setup(live:boolean){await mkdir(root,{recursive:true});const accounts=join(root,'accounts.local.json');
 if(!existsSync(accounts))await writeFile(accounts,JSON.stringify([{userId:'student',name:'学生',password:randomBytes(18).toString('base64url')}],null,2)+'\n',{flag:'wx'});
 const profile={...modelExample.profile,limits:{...modelExample.profile.limits,maxCalls:8,maxOutputTokens:4096,maxTotalTokens:150000,maxCostMicros:2000000,maxInputCharacters:100000}};
 const model={...modelExample,profile,authorization:{enabled:live,operatorApproved:live,expiresAt:live?Date.now()+3600000:0,maxRuns:32},planning:'pi-knowledge',questionDelivery:'natural-bridge',outputRepair:'json-fence-only',evidenceGrounding:'unique-excerpt',
  recovery:{httpMaxAttempts:3,maxModelRepairs:1,baseDelayMs:250,maxDelayMs:3000,initialOutputTokens:1500,maxOutputRecoveries:1,truncationMode:'regenerate',maxContextCompactions:1,autoCompact:{enabled:true,windowTokens:131072,triggerRatio:.8}}};
 const old=existsSync(configFile)?JSON.parse(await readFile(configFile,'utf8')):undefined;
 const config=PilotConfigSchema.parse({version:1,mode:live?'live':'offline-fixture',stateDir:join(root,'state'),usersFile:accounts,
  internalToken:old?.internalToken??randomBytes(32).toString('hex'),apiPort:3100,agentPort:3200,allowDraftKnowledge:true,expressionEnabled:live,
  model,budget:{maxCostMicros:2000000,maxCalls:40,maxConcurrent:2}});
 await writeFile(configFile,JSON.stringify(config,null,2)+'\n');console.log(JSON.stringify({mode:config.mode,configFile,accountsFile:accounts,
  note:'账号文件由本机运营者管理；未打印密码或Key。live授权1小时、最多32次运行，每场声明额度2元/40请求；不是供应商账单保证。草案知识待独立审核。'}));
}
const args=process.argv.slice(2);const command=args[0]??'help';
if(command==='setup'){
 if(args.some((a,i)=>i>0&&a!=='--live'))throw Error('Invalid arguments');await setup(args.includes('--live'));
}else if(command==='start'||command==='agent'||command==='api'){
 const option=args.indexOf('--config'),file=option>=0?args[option+1]:configFile;if(!file)throw Error('Config missing');const config=await readPilotConfig(file);
 if(command==='start'){
  const common:NodeJS.ProcessEnv={...process.env,INTERVIEW_PILOT_CONFIG:file};const apiEnv:NodeJS.ProcessEnv={...common};delete apiEnv.INTERVIEW_QIANWEN_API_KEY;delete apiEnv.INTERVIEW_BAILIAN_ASR_API_KEY;
  const children=[Bun.spawn([process.execPath,'run',import.meta.path,'agent','--config',file],{env:common,stdout:'inherit',stderr:'inherit'}),
   Bun.spawn([process.execPath,'--no-env-file','run',import.meta.path,'api','--config',file],{env:apiEnv,stdout:'inherit',stderr:'inherit'})];
  let stopped=false;const stop=()=>{if(stopped)return;stopped=true;for(const p of children)p.kill('SIGTERM');};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const code=await Promise.race(children.map(p=>p.exited));stop();await Promise.allSettled(children.map(p=>p.exited));process.exitCode=code;
 }else{
  const component=command==='agent'?await createPilotAgent(config,{apiUrl:()=>`http://127.0.0.1:${config.apiPort}`,readCredential:name=>process.env[name]}):await createPilotApi(config,`http://127.0.0.1:${config.agentPort}`);
  const server=Bun.serve({hostname:'127.0.0.1',port:command==='agent'?config.agentPort:config.apiPort,fetch:component.app.fetch});
  console.log(JSON.stringify({service:command,mode:config.mode,url:`http://127.0.0.1:${server.port}`}));let closing=false;
  const close=()=>{if(closing)return;closing=true;void(async()=>{await server.stop(true);try{await component.close();}catch{console.error('PILOT_SHUTDOWN_INCOMPLETE');process.exitCode=1;}})();};
  process.on('SIGINT',close);process.on('SIGTERM',close);
 }
}else console.log('pilot setup [--live] | start | agent | api [--config path]');
