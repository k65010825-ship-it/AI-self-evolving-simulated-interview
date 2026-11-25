import type {Database} from 'bun:sqlite';
import type {ExperimentRepository} from '../../apps/agent/src/reflection/repository-port.ts';
import {LocalExperimentRecordSchema,type LocalExperimentRecord} from '../../packages/contracts/src/local-experiment.ts';

/** TEST ONLY: disposable SQLite fixture in host profile; not a shipped schema/migration/repository. */
export function createSqliteExperimentFixture(){
 let rejectCommit=false;
 const has=(db:Database)=>!!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='test_experiment_fixture'").get();
 const all=(db:Database,userId:string):LocalExperimentRecord[]=>has(db)
  ?(db.query('SELECT body FROM test_experiment_fixture WHERE user_id=?').all(userId) as {body:string}[]).map(r=>LocalExperimentRecordSchema.parse(JSON.parse(r.body)))
  :[];
 const repository:ExperimentRepository={
  load:(db,userId,experimentId)=>all(db,userId).find(r=>r.experimentId===experimentId)??null,
  list:(db,userId,roleId)=>all(db,userId).filter(r=>!roleId||r.roleId===roleId),
  findOperation:(db,userId,operationId)=>all(db,userId).find(r=>r.operations.some(o=>o.operationId===operationId))??null,
  pending:(db,userId)=>all(db,userId).filter(r=>r.runs.some(x=>x.status==='queued'||x.status==='running')),
  save(db,userId,next,expectedVersion){
   db.exec('CREATE TABLE IF NOT EXISTS test_experiment_fixture(user_id TEXT NOT NULL,experiment_id TEXT PRIMARY KEY,version INTEGER NOT NULL,body TEXT NOT NULL)');
   const prev=repository.load(db,userId,next.experimentId);
   if((prev?.version??null)!==expectedVersion)throw Error('fixture CAS');
   for(const op of next.operations){
    const owner=repository.findOperation(db,userId,op.operationId);
    if(owner&&owner.experimentId!==next.experimentId)throw Error('fixture operation conflict');
   }
   db.query('INSERT INTO test_experiment_fixture VALUES(?,?,?,?) ON CONFLICT(experiment_id) DO UPDATE SET version=excluded.version,body=excluded.body')
    .run(userId,next.experimentId,next.version,JSON.stringify(next));
   if(rejectCommit)throw Error('synthetic commit fault');
  },
 };
 return{repository,rejectCommits:(value:boolean)=>{rejectCommit=value;}};
}
