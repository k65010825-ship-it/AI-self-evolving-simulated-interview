import {test,expect} from 'bun:test';
import {runRecoveryBoundaryCase} from '../experiments/recovery-boundaries/cases.ts';
for(const role of ['java-backend','web-frontend']as const){
 for(const scenario of ['cancel-late','deadline-late','terminal-cancel','terminal-timeout','terminal-completed','lease-reserved','lease-dispatched']as const){
  test(`${role}: recovery boundary ${scenario} preserves result and accounting invariants`,async()=>{
   const r=await runRecoveryBoundaryCase(role,scenario);expect(r.checks.every(c=>c.passed)).toBe(true);expect(r.liveModelCalls).toBe(0);
  });
 }
}
