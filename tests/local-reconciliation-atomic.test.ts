import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {openLocalProfile} from '../apps/agent/src/local/profile-store.ts';import {createLocalLiveStore} from '../apps/agent/src/local/live-store.ts';import {createModelBudgetGate} from '../apps/agent/src/model-access/budget.ts';
import config from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
test('reconciliation receipt failure atomically retains unknown holds; successful replay survives restart without a second charge',async()=>{
 const data=await mkdtemp(join(tmpdir(),'reconcile-atomic-'));const options={dataDir:data,assetsRoot:process.cwd(),now:()=>1000};let profile=openLocalProfile(options);
 try{
  profile.write(db=>{
   db.query('INSERT INTO local_sessions VALUES(?,?,?,?,?,?)').run('session','java-backend',0,null,1000,999999);
   db.query('INSERT INTO local_jobs VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL,?)').run('job','operation','session','java-backend','synthetic',JSON.stringify({context:{runId:'job',attemptId:'attempt',userId:profile.profileId,roleId:'java-backend',deadlineAt:99999}}),'{}','running',1000);
  });
  let store=createLocalLiveStore(profile,{now:options.now});store.createSessionBudget({sessionId:'session',profile:config.profile,limits:{maxCalls:2,maxTotalTokens:1000,maxCostMicros:100000}});
  store.authorize({sessionId:'session',grantId:'grant',expectedVersion:0,expiresAt:99999,credentialRef:'synthetic-ref',profile:config.profile});
  const gate=createModelBudgetGate(config.profile,{budgetId:'budget',userId:profile.profileId,roleId:'java-backend',runId:'job',attemptId:'attempt',deadlineAt:99999},{now:options.now,allowLive:true,onCheckpoint:snapshot=>store.checkpoint({sessionId:'session',jobId:'job',runId:'job',attemptId:'attempt',grantId:'grant',snapshot,profile:config.profile})});
  gate.reserve('http-1',{inputTokens:100,outputTokens:30});gate.dispatch('http-1');gate.markUnknown('http-1');
  profile.write(db=>{db.query("UPDATE local_jobs SET status='cancelled' WHERE job_id='job'").run();db.exec("CREATE TRIGGER reject_reconciliation BEFORE INSERT ON local_live_reconciliations BEGIN SELECT RAISE(ABORT,'synthetic-receipt-write-failure'); END");});
  const before=store.checkpoints(),totals=store.totals('session'),command={sessionId:'session',jobId:'job',runId:'job',attemptId:'attempt',callId:'http-1',expectedVersion:before[0]!.snapshot.version,usage:{inputTokens:10,outputTokens:2,complete:true},evidenceRef:'synthetic-usage-record'};
  expect(()=>store.reconcile(command)).toThrow('synthetic-receipt-write-failure');
  expect(store.checkpoints()).toEqual(before);expect(store.totals('session')).toEqual(totals);expect(store.hasBlockedAccounting()).toBe(true);
  expect(profile.read(db=>db.query('SELECT COUNT(*) AS n FROM local_live_reconciliations').get())).toEqual({n:0});
  profile.write(db=>db.exec('DROP TRIGGER reject_reconciliation'));
  const receipt=store.reconcile(command);expect(receipt.toVersion).toBe(command.expectedVersion+1);expect(receipt.authority).toBe('host-supplied-usage-not-vendor-verified');
  expect(store.totals('session')).toMatchObject({callsConsumed:1,usedTokens:12,heldTokens:0,activeSlots:0});expect(store.hasBlockedAccounting()).toBe(false);
  profile.close();profile=openLocalProfile(options);store=createLocalLiveStore(profile,{now:options.now});const settled=store.checkpoints();
  expect(store.reconcile({...command,expectedVersion:999})).toEqual(receipt);expect(store.checkpoints()).toEqual(settled);
  expect(()=>store.reconcile({...command,usage:{inputTokens:11,outputTokens:2,complete:true}})).toThrow('LOCAL_RECONCILIATION_CONFLICT');
  expect(store.totals('session')).toMatchObject({callsConsumed:1,usedTokens:12,heldTokens:0});expect(profile.read(db=>db.query('SELECT COUNT(*) AS n FROM local_live_reconciliations').get())).toEqual({n:1});
  expect(profile.read(db=>db.query("SELECT status FROM local_jobs WHERE job_id='job'").get())).toEqual({status:'cancelled'});
 }finally{profile.close();await rm(data,{recursive:true,force:true});}
});
