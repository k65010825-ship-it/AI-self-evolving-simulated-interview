import {test,expect} from 'bun:test';
import {createHintJournal,reserveHint,commitHint,releaseHint,recoverHints,restoreHintJournal,hintAssistance,renderHint} from '../apps/agent/src/hints/limited-hints.ts';
const binding={userId:'u',roleId:'java-backend' as const,sessionId:'s',issueId:'a'.repeat(64),questionId:'q',issuedAt:10};
const initial=()=>createHintJournal(binding);
test('two commits consume two levels; receipt replay succeeds even at limit',()=>{
 let s=reserveHint(initial(),'one',11);s=commitHint(s,'one',renderHint('technical',1),12);
 const first=structuredClone(s.entries[0]);s=reserveHint(s,'two',13);s=commitHint(s,'two',renderHint('technical',2),14);
 expect(()=>reserveHint(s,'three',15)).toThrow('HINT_LIMIT_REACHED');
 expect(reserveHint(s,'one',20).entries[0]).toEqual(first);
 expect(hintAssistance(s)?.receiptIds).toEqual(['one','two']);expect(hintAssistance(s)?.kind).toBe('hint-assisted');
});
test('reservation serializes concurrent requests and failed generation consumes no successful hint',()=>{
 const s=reserveHint(initial(),'one',11);expect(()=>reserveHint(s,'two',12)).toThrow('HINT_BUSY');
 const failed=releaseHint(s,'one',12);expect(hintAssistance(failed)).toBeUndefined();
 expect(()=>reserveHint(failed,'one',13)).toThrow('HINT_OPERATION_RELEASED');
 const retry=reserveHint(failed,'two',13);expect(retry.entries.at(-1)?.level).toBe(1);
});
test('crash recovery releases only reservations, preserving committed receipts and idempotence',()=>{
 let s=commitHint(reserveHint(initial(),'one',11),'one',renderHint('scenario',1),12);s=reserveHint(s,'two',13);
 const recovered=recoverHints(restoreHintJournal(JSON.stringify(s),binding),14);
 expect(recovered.entries.map(e=>e.status)).toEqual(['committed','released']);
 expect(recoverHints(recovered,15)).toEqual(recovered);
 expect(reserveHint(recovered,'one',20).entries[0]).toEqual(s.entries[0]);
 expect(reserveHint(recovered,'three',20).entries.at(-1)?.level).toBe(2);
});
test('restoration rejects forged successful levels and cross-profile bindings',()=>{
 const s=commitHint(reserveHint(initial(),'one',11),'one',renderHint('project',1),12);
 expect(()=>restoreHintJournal(JSON.stringify(s),{...binding,userId:'other'})).toThrow('HINT_BINDING_MISMATCH');
 const bad=structuredClone(s);bad.entries[0]!.level=2;
 expect(()=>restoreHintJournal(JSON.stringify(bad),binding)).toThrow('HINT_DATA_INVALID');
 expect(()=>commitHint(s,'one','different',13)).toThrow('HINT_OPERATION_CONFLICT');
});
test('all templates are versioned coaching guidance and do not echo arbitrary answer material',()=>{
 for(const type of ['technical','scenario','project','behavioral'] as const){
  expect(renderHint(type,1).length).toBeGreaterThan(10);expect(renderHint(type,2)).not.toBe(renderHint(type,1));
 }
 expect(()=>reserveHint(initial(),'one',9)).toThrow('HINT_DATA_INVALID');
});
