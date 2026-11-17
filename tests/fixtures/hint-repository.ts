import type {Database} from 'bun:sqlite';import type {HintRepository} from '../../apps/agent/src/hints/repository-port.ts';
import {HintJournalSchema,type HintJournal} from '../../packages/contracts/src/hints.ts';
/** TEST ONLY: synthetic table in disposable host profile; not a shipped schema/migration/repository. */
export function createSqliteHintFixture(){let rejectCommit=false;
 const has=(db:Database)=>!!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='test_hint_fixture'").get();
 const all=(db:Database):HintJournal[]=>has(db)?db.query('SELECT body FROM test_hint_fixture').all().map(row=>HintJournalSchema.parse(JSON.parse((row as {body:string}).body))):[];
 const repository:HintRepository={
  load:(db,b)=>all(db).find(s=>s.binding.issueId===b.issueId)??null,
  findOperation:(db,userId,id)=>all(db).find(s=>s.binding.userId===userId&&s.entries.some(e=>e.operationId===id))?.binding??null,
  pending:(db,userId)=>all(db).filter(s=>s.binding.userId===userId&&s.entries.some(e=>e.status==='reserved')),
  save(db,s,expectedVersion){
   db.exec('CREATE TABLE IF NOT EXISTS test_hint_fixture(issue_id TEXT PRIMARY KEY,version INTEGER NOT NULL,body TEXT NOT NULL)');
   const previous=repository.load(db,s.binding);if((previous?.version??null)!==expectedVersion)throw Error('fixture CAS');
   for(const e of s.entries){const owner=repository.findOperation(db,s.binding.userId,e.operationId);if(owner&&owner.issueId!==s.binding.issueId)throw Error('fixture operation conflict');}
   db.query('INSERT INTO test_hint_fixture VALUES(?,?,?) ON CONFLICT(issue_id) DO UPDATE SET version=excluded.version,body=excluded.body').run(s.binding.issueId,s.version,JSON.stringify(s));
   // Throw AFTER the UPDATE to verify the host transaction rolls it back atomically.
   if(rejectCommit&&s.entries.some(e=>e.status==='committed'))throw Error('synthetic commit fault');
  },
 };return{repository,rejectCommits:(value:boolean)=>{rejectCommit=value;}};
}
