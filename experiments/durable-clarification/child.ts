import {readFileSync,writeFileSync} from 'node:fs';
import {createDurableLiveRunManager} from '../../apps/agent/src/runtime/durable-runtime.ts';
import {fixtureStream} from './fixture.ts';
import {contentHash} from '../../evals/answers/validation.ts';
// This entrypoint only receives an internally generated synthetic fixture file via direct argv.
try{
 const payload=JSON.parse(readFileSync(process.argv[2]!,'utf8'));let httpAttempts=0,credentialReads=0;
 const r=createDurableLiveRunManager(payload.config,{readCredential:()=>{credentialReads++;return 'synthetic-only';},fetch:async()=>{httpAttempts++;return fixtureStream(payload.output);}},{path:payload.database,ownerId:'child'});
 r.start(payload.request);await r.wait(payload.request.context.runId);const result=r.snapshot(payload.request.context.runId);
 if(result.status!=='completed'||result.result?.kind!=='uncommitted-unscored-turn-result'||result.result.resolution.clarificationTemplate!=='observation-v1')throw Error();
 const events=[];for await(const e of r.events(payload.request.context.runId))events.push(e);
 writeFileSync(payload.metrics,JSON.stringify({httpAttempts,credentialReads,resultDigest:contentHash(result),eventsDigest:contentHash(events),budgetsDigest:contentHash(r.modelAccounting())}));
 // Deliberately exit without a graceful manager close: only committed SQLite data survives.
 process.exit(0);
}catch{console.error('DURABLE_CLARIFICATION_CHILD_FAILED');process.exit(2);}
