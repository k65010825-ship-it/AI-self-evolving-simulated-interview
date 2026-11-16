import {test,expect} from 'bun:test';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';
import cfg from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
const secret='synthetic-stdio-private-key-do-not-store';
const assetsRoot=process.cwd(),entry=resolve('experiments/local-runtime/live-fixture.ts');
const limits={maxCalls:6,maxTotalTokens:100000,maxCostMicros:1000000};
const config={...cfg,profile:{...cfg.profile,limits:{...cfg.profile.limits,...limits}},planning:'pi-knowledge',questionDelivery:'canonical'};
type Client=Awaited<ReturnType<typeof spawnLocalAgent>>;
async function scan(root:string):Promise<Buffer[]>{const out:Buffer[]=[];for(const e of await readdir(root,{withFileTypes:true})){const path=join(root,e.name);if(e.isDirectory())out.push(...await scan(path));else out.push(await readFile(path));}return out;}
async function audit(data:string){try{return(await readFile(join(data,'fixture-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return[];throw e;}}
async function create(client:Client,roleId:string,prefix:string){const created=await client.request('session.create',{operationId:prefix+'-create',roleId,goal:'合成stdio离线注入验收',durationMinutes:20,mode:'live',liveConfig:config,sessionBudget:limits}) as {jobId:string;sessionId:string};expect(await client.waitForJob(created.jobId)).toMatchObject({status:'completed'});return created;}
async function grant(client:Client,sessionId:string,grantId:string){return client.request('live.authorize',{sessionId,grantId,expectedVersion:0,expiresAt:Date.now()+60000,credentialRef:'synthetic-model-key',profile:config.profile});}
async function failureCode(promise:Promise<unknown>){try{await promise;return 'UNEXPECTED_SUCCESS';}catch(e){return(e as Error).message;}}
test('real stdio runs two roles with private synthetic credentials, preserves budget on restart and emits no public secret',async()=>{
 const data=await mkdtemp(join(tmpdir(),'本地 live stdio 空格-')),publicData:unknown[]=[];let keys=0;
 const start=()=>spawnLocalAgent({executable:process.execPath,entry,dataDir:data,assetsRoot,cwd:tmpdir(),resolveCredential:async()=>{keys++;return secret;}});
 let client=await start();const sessions:string[]=[];
 try{publicData.push(await client.request('runtime.initialize',{}));client.subscribe(event=>publicData.push(event));
 for(const role of ['java-backend','web-frontend']){
  const c=await create(client,role,role);sessions.push(c.sessionId);expect((await audit(data)).length).toBe(sessions.length===1?0:3);publicData.push(await grant(client,c.sessionId,'grant-'+role));
  for(const [method,revision,extra]of [['session.nextQuestion',0,{}],['session.answer',1,{text:'合成答案：我会明确状态边界并核验失败与恢复路径。'}]]as const){const job=await client.request(method,{sessionId:c.sessionId,operationId:role+'-'+method,expectedRevision:revision,...extra})as {jobId:string};publicData.push(await client.waitForJob(job.jobId));expect(publicData.at(-1)).toMatchObject({status:'completed'});publicData.push(await client.request('job.events',{jobId:job.jobId,afterSeq:0}));}
  publicData.push(await client.request('session.get',{sessionId:c.sessionId}));expect(publicData.at(-1)).toMatchObject({mode:'live',answeredCount:1,revision:2});expect(await client.request('live.budget',{sessionId:c.sessionId})).toMatchObject({totals:{callsConsumed:3}});
 }
 expect(await audit(data)).toHaveLength(6);expect(keys).toBe(4);await client.close();const before=keys;client=await start();publicData.push(await client.request('runtime.initialize',{}));client.subscribe(event=>publicData.push(event));
 for(const [i,sessionId]of sessions.entries()){
  const budget=await client.request('live.budget',{sessionId});publicData.push(budget);expect(budget).toMatchObject({totals:{callsConsumed:3}});
  expect(await client.request('session.get',{sessionId})).toMatchObject({mode:'live',revision:2});
  const done=await client.request('session.complete',{sessionId,operationId:'finish-'+i,expectedRevision:2})as {jobId:string};expect(await client.waitForJob(done.jobId)).toMatchObject({status:'completed'});publicData.push(await client.request('session.get',{sessionId}));expect(publicData.at(-1)).toMatchObject({phase:'completed'});
 }
 expect(keys).toBe(before);expect(await audit(data)).toHaveLength(6);expect(await client.request('runtime.status',{})).toMatchObject({modelHttpAttempts:0});await client.close();
 expect(JSON.stringify(publicData)).not.toContain(secret);for(const bytes of await scan(data))expect(bytes.includes(Buffer.from(secret))).toBe(false);
 }finally{await client.close();await rm(data,{recursive:true,force:true});}
},60000);
test('missing main-process resolver fails live execution before any injected HTTP',async()=>{
 const data=await mkdtemp(join(tmpdir(),'local-live-no-resolver-'));const client=await spawnLocalAgent({executable:process.execPath,entry,dataDir:data,assetsRoot,cwd:tmpdir()});
 try{await client.request('runtime.initialize',{});const c=await create(client,'java-backend','missing');expect(await failureCode(grant(client,c.sessionId,'missing-grant'))).toBe('CREDENTIAL_NOT_NEGOTIATED');expect(await failureCode(client.request('session.nextQuestion',{sessionId:c.sessionId,operationId:'missing-plan',expectedRevision:0}))).toBe('LOCAL_GRANT_INACTIVE');expect(await audit(data)).toHaveLength(0);expect(await client.request('runtime.status',{})).toMatchObject({modelHttpAttempts:0});expect(await client.request('live.budget',{sessionId:c.sessionId})).toMatchObject({totals:{callsConsumed:0}});
 }finally{await client.close();await rm(data,{recursive:true,force:true});}
},30000);
