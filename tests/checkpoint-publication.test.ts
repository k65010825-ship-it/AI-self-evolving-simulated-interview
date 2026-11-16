import{test,expect}from'bun:test';
import{createRunManager}from'../apps/agent/src/runtime/run-manager.ts';
import{runtimeRequest}from'./helpers/runtime-request.ts';
import{fixtureAssessment}from'../experiments/pi-sdk/evaluation-fixture.ts';
for(const point of ['run.stage','run.completed']as const)test(`failed ${point} checkpoint never publishes unpersisted events or hangs subscribers`,async()=>{
 const saved:string[]=[];let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});
 const runtime=createRunManager({evaluateForRole:()=>async()=>{entered();await new Promise<void>(r=>{release=r;});return fixtureAssessment;},
  onCheckpoint:(_snapshot,event)=>{if(event.type===point)throw Error('synthetic-disk-failure');saved.push(event.type);}});
 const req=runtimeRequest('checkpoint-'+point.replace('.','-'));runtime.start(req);
 const seen:string[]=[];const reading=(async()=>{for await(const e of runtime.events(req.context.runId))seen.push(e.type);return true;})();
 if(point==='run.completed'){await started;await new Promise(r=>setTimeout(r,1));release();}await runtime.wait(req.context.runId);
 expect(await Promise.race([reading,new Promise(r=>setTimeout(()=>r(false),200))])).toBe(true);
 expect(seen).not.toContain(point);expect(seen).toEqual(saved);expect(runtime.snapshot(req.context.runId).status).toBe('failed');runtime.dispose();
});
