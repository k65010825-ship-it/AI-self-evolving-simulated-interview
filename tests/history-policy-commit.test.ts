import {test,expect} from 'bun:test';
import {commitSource} from './helpers/commit-source.ts';
import {createWorkflowCommitTicket,prepareWorkflowCommit} from '../packages/agent-client/src/workflow-commit.ts';
import {seedHistoryCompatibility} from '../apps/agent/src/tools/knowledge-executor.ts';
test('create commit binds optional history policy exactly and preserves legacy creation',async()=>{
 for(const role of ['java-backend','web-frontend'] as const){
  const f=await commitSource(role);
  try{
   expect(prepareWorkflowCommit({ticket:f.ticket,request:f.request,run:f.run,current:f.current,receipt:null,now:Date.now()}).kind).toBe('uncommitted-workflow-commit-plan');
   const request=structuredClone(f.request);if(request.job.type!=='workflow'||request.job.operation.action!=='create')throw Error('create');
   request.context.runId+='-pinned';request.inputSnapshotId+='-pinned';const config=request.job.operation.config;
   config.session.historyCompatibility=seedHistoryCompatibility(role,config.session.skills.map(s=>s.skillId));
   const run=await f.execute(request),now=Date.now();
   const ticket=createWorkflowCommitTicket({identity:f.identity,request,operationId:'pinned',taskId:'pinned',leaseVersion:1,expectedStorageVersion:null,expectedMemoryVersion:0,issuedAt:now,leaseUntil:now+30000});
   const input={ticket,request,run,current:f.current,receipt:null,now};
   expect(prepareWorkflowCommit(input).kind).toBe('uncommitted-workflow-commit-plan');
   for(const mode of ['remove','replace']){
    const changed=structuredClone(run);if(changed.result?.kind!=='uncommitted-workflow-result')throw Error('workflow');
    if(mode==='remove')delete changed.result.snapshot.state.historyCompatibility;
    else changed.result.snapshot.state.historyCompatibility!.allowed=[];
    expect(()=>prepareWorkflowCommit({...input,run:changed})).toThrow('COMMIT_TRANSITION_INVALID');
   }
  }finally{f.runtime.dispose();}
 }
});
test('seed compatibility is stable, skill-scoped, role-separated and detached from callers',()=>{
 const a=seedHistoryCompatibility('java-backend',['collaboration','project-design']);
 expect(seedHistoryCompatibility('java-backend',['project-design','collaboration'])).toEqual(a);
 expect(seedHistoryCompatibility('web-frontend',['project-design','collaboration']).id).not.toBe(a.id);
 expect(a.allowed.every(v=>v.skillId==='project-design'||v.skillId==='collaboration')).toBe(true);
 const original=structuredClone(a);a.allowed[0]!.rubricVersion='tampered';
 expect(seedHistoryCompatibility('java-backend',['collaboration','project-design'])).toEqual(original);
 expect(seedHistoryCompatibility('java-backend',['nonexistent']).allowed).toEqual([]);
});
