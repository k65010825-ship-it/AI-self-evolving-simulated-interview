import { z } from 'zod';
import { MemoryIdentitySchema, MemorySnapshotSchema, AppendMemorySchema, StartSessionMemorySchema,
  type MemorySnapshot } from '../../../../packages/contracts/src/memory.ts';
import { InterviewStateSchema, type InterviewState } from '../../../../packages/contracts/src/interview-state.ts';
import { AgentStateError, createInterviewState } from '../planning/interview-state.ts';
import { buildInterviewReport } from '../reporting/build-report.ts';
const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{
  const result=schema.safeParse(value); if(!result.success) throw new AgentStateError('VALIDATION_ERROR'); return result.data;
};
function authorize(memory:MemorySnapshot,identity:z.infer<typeof MemoryIdentitySchema>) {
  if(memory.userId!==identity.userId) throw new AgentStateError('FORBIDDEN');
  if(memory.roleId!==identity.roleId) throw new AgentStateError('ROLE_FORBIDDEN');
}
export function createMemory(rawIdentity:unknown,now:number):MemorySnapshot {
  const identity=parse(MemoryIdentitySchema,rawIdentity);
  return parse(MemorySnapshotSchema,{schemaVersion:1,kind:'uncommitted-memory-snapshot',...identity,version:0,updatedAt:now,sessions:[]});
}
export async function appendMemory(rawMemory:unknown,rawRequest:unknown):Promise<MemorySnapshot> {
  const memory=parse(MemorySnapshotSchema,rawMemory),request=parse(AppendMemorySchema,rawRequest); authorize(memory,request);
  if(request.reportInput.generatedAt>request.now) throw new AgentStateError('VALIDATION_ERROR');
  if(request.reportInput.state.roleId!==memory.roleId) throw new AgentStateError('ROLE_FORBIDDEN');
  if(request.reportInput.turns.some(t=>t.input.context.userId!==memory.userId)) throw new AgentStateError('FORBIDDEN');
  const report=await buildInterviewReport(request.reportInput);
  const existing=memory.sessions.find(s=>s.sessionId===report.sessionId);
  if(existing && request.now<existing.acceptedAt) throw new AgentStateError('VALIDATION_ERROR');
  const session={sessionId:report.sessionId,stateVersion:report.sessionVersion,endedAt:report.generatedAt,
    acceptedAt:existing?.acceptedAt??request.now,
    policyVersion:report.policyVersion,evidenceMode:report.evidenceMode,
    observations:request.reportInput.state.observations.map(o=>{
      const assessment=report.assessments.find(a=>a.observationId===o.observationId)!;
      const turn=request.reportInput.turns.find(t=>t.input.observationId===o.observationId)!;
      return {...o,sessionId:report.sessionId,rubricId:assessment.rubricId,rubricVersion:assessment.rubricVersion,evidenceMode:turn.evidenceMode};
    })};
  if(existing) {
    if(JSON.stringify(existing)!==JSON.stringify(session)) throw new AgentStateError('VERSION_CONFLICT');
    return memory;
  }
  if(request.now<memory.updatedAt) throw new AgentStateError('VALIDATION_ERROR');
  if(request.expectedVersion!==memory.version) throw new AgentStateError('VERSION_CONFLICT');
  return parse(MemorySnapshotSchema,{...memory,version:memory.version+1,updatedAt:request.now,
    sessions:[...memory.sessions,session].sort((a,b)=>a.endedAt-b.endedAt || (a.sessionId<b.sessionId?-1:1))});
}
export function restoreMemory(json:string,rawIdentity:unknown):MemorySnapshot {
  const identity=parse(MemoryIdentitySchema,rawIdentity);
  if(typeof json!=='string'||json.length>4000000) throw new AgentStateError('VALIDATION_ERROR');
  let value:unknown; try{value=JSON.parse(json);}catch{throw new AgentStateError('VALIDATION_ERROR');}
  const memory=parse(MemorySnapshotSchema,value); authorize(memory,identity); return memory;
}
export function startSessionFromMemory(rawMemory:unknown,rawRequest:unknown):InterviewState {
  const memory=parse(MemorySnapshotSchema,rawMemory),request=parse(StartSessionMemorySchema,rawRequest); authorize(memory,request);
  if(request.session.roleId!==memory.roleId) throw new AgentStateError('ROLE_FORBIDDEN');
  if(request.now<memory.updatedAt) throw new AgentStateError('VALIDATION_ERROR');
  if(memory.sessions.some(s=>s.sessionId===request.session.sessionId)) throw new AgentStateError('VERSION_CONFLICT');
  const state=createInterviewState(request.session,request.now);
  const skills=new Set(state.skills.map(s=>s.skillId));
  const priorEvidence=memory.sessions.flatMap(s=>s.observations).filter(o=>skills.has(o.skillId))
    .sort((a,b)=>a.observedAt-b.observedAt || (a.sessionId<b.sessionId?-1:a.sessionId>b.sessionId?1:0));
  return parse(InterviewStateSchema,{...state,priorEvidence});
}
