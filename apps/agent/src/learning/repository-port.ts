import type {Database} from 'bun:sqlite';
import type {RoleId} from '../../../../packages/contracts/src/tools.ts';
import type {LocalLearningRecord} from '../../../../packages/contracts/src/local-learning.ts';

/** DB owner implements this against the host's existing SQLite connection/transaction, never a second DB.
 * save must CAS on record.version (null means absent), atomically persist the full learning record,
 * and enforce profile-wide operationId uniqueness; exceptions roll back the host transaction.
 * No method may await, call a provider, change profile ownership, or commit its own transaction.
 */
export interface LearningRepository{
 load(db:Database,userId:string,assignmentId:string):LocalLearningRecord|null;
 list(db:Database,userId:string,roleId?:RoleId):LocalLearningRecord[];
 save(db:Database,userId:string,next:LocalLearningRecord,expectedVersion:number|null):void;
 findOperation(db:Database,userId:string,operationId:string):LocalLearningRecord|null;
}
