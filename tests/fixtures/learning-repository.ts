import type {Database} from 'bun:sqlite';
import type {LearningRepository} from '../../apps/agent/src/learning/repository-port.ts';
import {LocalLearningRecordSchema,type LocalLearningRecord} from '../../packages/contracts/src/local-learning.ts';

/** TEST ONLY: disposable SQLite fixture in host profile; not a shipped schema/migration/repository. */
export function createSqliteLearningFixture(){
 let rejectCommit=false;
 const has=(db:Database)=>!!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='test_learning_fixture'").get();
 const all=(db:Database,userId:string):LocalLearningRecord[]=>has(db)
  ?(db.query('SELECT body FROM test_learning_fixture WHERE user_id=?').all(userId) as {body:string}[]).map(r=>LocalLearningRecordSchema.parse(JSON.parse(r.body)))
  :[];
 const repository:LearningRepository={
  load:(db,userId,assignmentId)=>all(db,userId).find(r=>r.assignmentId===assignmentId)??null,
  list:(db,userId,roleId)=>all(db,userId).filter(r=>!roleId||r.roleId===roleId),
  findOperation:(db,userId,operationId)=>all(db,userId).find(r=>r.operations.some(o=>o.operationId===operationId))??null,
  save(db,userId,next,expectedVersion){
   db.exec('CREATE TABLE IF NOT EXISTS test_learning_fixture(user_id TEXT NOT NULL,assignment_id TEXT PRIMARY KEY,version INTEGER NOT NULL,body TEXT NOT NULL)');
   const prev=repository.load(db,userId,next.assignmentId);
   if((prev?.version??null)!==expectedVersion)throw Error('fixture CAS');
   for(const op of next.operations){
    const owner=repository.findOperation(db,userId,op.operationId);
    if(owner&&owner.assignmentId!==next.assignmentId)throw Error('fixture operation conflict');
   }
   db.query('INSERT INTO test_learning_fixture VALUES(?,?,?,?) ON CONFLICT(assignment_id) DO UPDATE SET version=excluded.version,body=excluded.body')
    .run(userId,next.assignmentId,next.version,JSON.stringify(next));
   if(rejectCommit)throw Error('synthetic commit fault');
  },
 };
 return{repository,rejectCommits:(value:boolean)=>{rejectCommit=value;}};
}
