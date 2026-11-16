import {test,expect} from 'bun:test';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {createRecoveryTree} from '../apps/agent/src/harness/recovery-tree.ts';
test('Pi recovery retains failed entries while rebuilding a clean active branch',()=>{
 const manager=SessionManager.inMemory(process.cwd()),tree=createRecoveryTree(manager,'a'.repeat(64));
 const user=manager.appendMessage({role:'user',content:'original request',timestamp:1});
 const failure=manager.appendCustomEntry('failed-output',{diagnostic:'invalid-json'});
 const before=manager.getEntries().length;const event=tree.recover(1);
 expect(event.rejectedLeafId).toBe(failure);expect(manager.getEntries().length).toBe(before+1);
 expect(manager.getEntry(user)).toBeDefined();expect(manager.getEntry(failure)).toBeDefined();
 expect(manager.getBranch().map(e=>e.id)).not.toContain(user);
 expect(manager.buildSessionContext().messages).toHaveLength(0);
 expect(()=>tree.recover(1)).toThrow('VERSION_CONFLICT');
});

import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {createEvaluationFixture,fixtureAssessment} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {runtimeRequest} from './helpers/runtime-request.ts';
import {ModelRecoveryPolicySchema} from '../packages/contracts/src/model-recovery.ts';
test('real Pi JSON repair branches without feeding rejected assistant output into the next model call',async()=>{
 let calls=0;const branches:unknown[]=[];
 const f=await createEvaluationFixture(context=>{
  expect(context.messages.filter(m=>m.role==='user')).toHaveLength(1);
  expect(context.messages.filter(m=>m.role==='assistant')).toHaveLength(0);
  return {text:++calls===1?'INVALID_BRANCH_PRIVATE':JSON.stringify(fixtureAssessment)};
 });
 const evaluate=createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,roleId:'java-backend',
  recovery:ModelRecoveryPolicySchema.parse({maxModelRepairs:1}),onBranch:e=>branches.push(e)});
 const result=await evaluateTurn(runtimeRequest('native-tree').job.input,{evaluate});
 expect(result.kind).toBe('uncommitted-turn-proposal');expect(calls).toBe(2);expect(branches).toHaveLength(1);
 expect(JSON.stringify(branches)).not.toContain('INVALID_BRANCH_PRIVATE');expect(f.stats.liveModelCalls).toBe(0);
});
