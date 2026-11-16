import type {SessionManager} from '@earendil-works/pi-coding-agent';
import {AgentStateError} from '../planning/interview-state.ts';
export interface RecoveryBranch {checkpointId:string;rejectedLeafId:string;recoveryLeafId:string;attempt:number;}
/** Request-local SDK tree only. Does not rewind committed business state or external effects. */
export function createRecoveryTree(manager:SessionManager,requestDigest:string){
 if(!/^[a-f0-9]{64}$/.test(requestDigest))throw new AgentStateError('VALIDATION_ERROR');
 const checkpointId=manager.appendCustomEntry('interview-harness-checkpoint',{requestDigest});let recovered=0;
 return {recover(attempt:number):RecoveryBranch{
  if(!Number.isSafeInteger(attempt)||attempt!==recovered+1)throw new AgentStateError('VERSION_CONFLICT');
  const rejectedLeafId=manager.getLeafId();
  if(!rejectedLeafId||!manager.getBranch().some(e=>e.id===checkpointId))throw new AgentStateError('VERSION_CONFLICT');
  manager.branch(checkpointId); // Native Pi append-only tree; failed branch remains inspectable.
  const recoveryLeafId=manager.appendCustomEntry('interview-harness-recovery',{attempt,requestDigest});recovered=attempt;
  return {checkpointId,rejectedLeafId,recoveryLeafId,attempt};
 }};
}
