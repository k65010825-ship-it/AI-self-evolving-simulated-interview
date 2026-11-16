import type {Database} from 'bun:sqlite';
import type {SessionAccounting} from '../agent/src/accounting/session-ledger.ts';
/** Add scope to the existing cache without discarding already paid audio or legacy holds. */
export function prepareQuestionAudioStore(db:Database){db.transaction(()=>{
 db.exec('CREATE TABLE IF NOT EXISTS question_audio(operation_id TEXT PRIMARY KEY,digest TEXT NOT NULL,status TEXT NOT NULL,audio BLOB,deadline_at INTEGER NOT NULL,session_id TEXT)');
 const columns=db.query('PRAGMA table_info(question_audio)').all() as {name:string}[];
 if(!columns.some(c=>c.name==='session_id'))db.exec('ALTER TABLE question_audio ADD COLUMN session_id TEXT');
}).immediate();}
/** Recovery changes operational status only; it never dispatches or refunds uncertain use. */
export function recoverExpiredQuestionAudio(db:Database,ledger:SessionAccounting,at=Date.now()){
 if(!Number.isSafeInteger(at)||at<0)throw Error('VOICE_RECOVERY_CLOCK_INVALID');
 return db.transaction(()=>{
  const rows=db.query("SELECT operation_id,session_id FROM question_audio WHERE status='running' AND deadline_at<=?").all(at) as {operation_id:string;session_id:string|null}[];
  for(const row of rows){
   if(row.session_id){const entry=ledger.snapshot(row.session_id).entries.find(e=>e.attemptId===row.operation_id);
    if(entry?.status==='dispatched')ledger.markUnknown(row.session_id,row.operation_id);
    else if(entry?.status==='reserved')ledger.release(row.session_id,row.operation_id);
   }
   // An old row has no scope linkage. Keep any ledger holds unchanged rather than guessing.
   db.query("UPDATE question_audio SET status='interrupted' WHERE operation_id=? AND status='running'").run(row.operation_id);
  }
  return rows.length;
 }).immediate();
}
