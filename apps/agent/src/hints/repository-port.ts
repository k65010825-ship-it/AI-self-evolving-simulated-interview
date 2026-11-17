import type {Database} from 'bun:sqlite';import type {HintBinding,HintJournal} from '../../../../packages/contracts/src/hints.ts';
/** DB owner implements this against the host's existing connection/transaction, never a second DB.
 * save must CAS (null means absent), atomically persist the entire journal and enforce a
 * profile-wide unique operationId across issues; exceptions roll back the host transaction.
 * pending returns ALL journals containing a reservation (at most 4000, otherwise fail closed).
 * No method may await, call a provider, change profile ownership or commit its own transaction.
 */
export interface HintRepository{
 load(db:Database,binding:HintBinding):HintJournal|null;
 save(db:Database,next:HintJournal,expectedVersion:number|null):void;
 findOperation(db:Database,userId:string,operationId:string):HintBinding|null;
 pending(db:Database,userId:string):HintJournal[];
}
