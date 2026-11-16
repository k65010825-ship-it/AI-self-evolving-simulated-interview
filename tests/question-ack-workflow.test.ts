import { test,expect } from 'bun:test';
import { runQuestionAcknowledgementDemo } from '../scripts/demo-question-ack.ts';
import { mkdir,readFile,writeFile,unlink,rmdir } from 'node:fs/promises';
import { join } from 'node:path';
for(const role of ['java-backend','web-frontend'] as const)test(`${role} confirms two issued packets through API CAS fixture and actual JSON round trips`,async()=>{
 const dir=join(process.cwd(),'.cache',`question-ack-test-${role}-${crypto.randomUUID()}`);await mkdir(dir,{recursive:true});let count=0;
 const file=join(dir,'sidecar.json');
 try{
  const result=await runQuestionAcknowledgementDemo(role,{persistRoundTrip:async row=>{count++;await writeFile(file,JSON.stringify(row));return JSON.parse(await readFile(file,'utf8'));}});
  expect(result.workflow.session.phase).toBe('completed');expect(result.confirmedQuestions).toBe(2);expect(count).toBe(4);
  expect(result.confirmations.every(c=>c.exactReplay&&c.packetStable&&c.confirmationSource==='client-reported')).toBe(true);
  expect(result.formalCommitted).toBe(false);expect(result.actualGuiVerified).toBe(false);expect(result.liveModelCalls).toBe(0);
 }finally{await unlink(file).catch(()=>{});await rmdir(dir);}
});
