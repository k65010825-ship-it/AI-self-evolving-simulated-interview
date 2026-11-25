import type {Database} from 'bun:sqlite';
import type {RoleId} from '../../../../packages/contracts/src/tools.ts';
import type {LocalExperimentRecord} from '../../../../packages/contracts/src/local-experiment.ts';

/** DB owner implements this against the host's existing SQLite connection/transaction, never a second DB.
 * save must CAS on record.version (null means absent), atomically persist the experiment record,
 * and enforce profile-wide operationId uniqueness; exceptions roll back the host transaction.
 * pending returns records with queued/running runs so startup recovers them to interrupted without re-execution.
 */
export interface ExperimentRepository{
 load(db:Database,userId:string,experimentId:string):LocalExperimentRecord|null;
 list(db:Database,userId:string,roleId?:RoleId):LocalExperimentRecord[];
 save(db:Database,userId:string,next:LocalExperimentRecord,expectedVersion:number|null):void;
 findOperation(db:Database,userId:string,operationId:string):LocalExperimentRecord|null;
 pending(db:Database,userId:string):LocalExperimentRecord[];
}
