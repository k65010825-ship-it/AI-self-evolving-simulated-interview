import {test,expect} from 'bun:test';import {Database} from 'bun:sqlite';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openSessionAccounting} from '../apps/agent/src/accounting/session-ledger.ts';
import {prepareQuestionAudioStore,recoverExpiredQuestionAudio} from '../apps/pilot/voice-recovery.ts';
import {removeAccountingTemp} from './helpers/accounting-temp.ts';
test('actual SQLite reopen marks expired dispatched voice interrupted and preserves unknown holds without replay',()=>{
 const dir=mkdtempSync(join(tmpdir(),'voice-recovery-')),path=join(dir,'voice.sqlite');let db=new Database(path);const ledger=openSessionAccounting(join(dir,'ledger.sqlite'),{now:()=>100});
 try{ledger.ensureSession({sessionId:'s',userId:'u',roleId:'java-backend',currency:'CNY',maxCostMicros:1000,maxCalls:5,maxConcurrent:2,deadlineAt:10000});
 ledger.reserve({sessionId:'s',userId:'u',roleId:'java-backend',attemptId:'tts-one',operationId:'tts-one',kind:'tts',reservedCostMicros:100,pricing:{source:'synthetic-hold',version:'1',unit:'request'}});ledger.dispatch('s','tts-one');
 prepareQuestionAudioStore(db);db.query('INSERT INTO question_audio VALUES(?,?,?,NULL,?,?)').run('tts-one','digest','running',200,'s');db.close();
 db=new Database(path);prepareQuestionAudioStore(db);expect(recoverExpiredQuestionAudio(db,ledger,150)).toBe(0);expect(recoverExpiredQuestionAudio(db,ledger,201)).toBe(1);
 expect(db.query('SELECT status,audio FROM question_audio WHERE operation_id=?').get('tts-one')).toEqual({status:'interrupted',audio:null});
 expect(ledger.snapshot('s')).toMatchObject({entries:[{status:'unknown'}],totals:{heldCostMicros:100,activeSlots:1,callsConsumed:1}});
 expect(recoverExpiredQuestionAudio(db,ledger,300)).toBe(0);expect(()=>ledger.reserve({sessionId:'s',userId:'u',roleId:'java-backend',attemptId:'retry',operationId:'tts-one',kind:'tts',reservedCostMicros:100,pricing:{source:'synthetic-hold',version:'1',unit:'request'}})).toThrow('SESSION_REPLAY_BLOCKED');
 }finally{db.close();ledger.close();removeAccountingTemp(dir);}
});
test('legacy running rows become interrupted while completed audio remains intact',()=>{
 const dir=mkdtempSync(join(tmpdir(),'voice-migration-')),db=new Database(join(dir,'voice.sqlite')),ledger=openSessionAccounting(join(dir,'ledger.sqlite'),{now:()=>100});
 try{db.exec('CREATE TABLE question_audio(operation_id TEXT PRIMARY KEY,digest TEXT NOT NULL,status TEXT NOT NULL,audio BLOB,deadline_at INTEGER NOT NULL)');
 db.query('INSERT INTO question_audio VALUES(?,?,?,?,?)').run('legacy','d','running',null,100);db.query('INSERT INTO question_audio VALUES(?,?,?,?,?)').run('done','d','completed',new Uint8Array([1,2]),100);
 prepareQuestionAudioStore(db);expect(recoverExpiredQuestionAudio(db,ledger,101)).toBe(1);
 expect(db.query('SELECT status FROM question_audio WHERE operation_id=?').get('legacy')).toEqual({status:'interrupted'});
 const done=db.query('SELECT status,audio FROM question_audio WHERE operation_id=?').get('done') as {status:string;audio:Uint8Array};expect(done.status).toBe('completed');expect([...done.audio]).toEqual([1,2]);
 }finally{db.close();ledger.close();removeAccountingTemp(dir);}
});
