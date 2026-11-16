import { Hono } from 'hono';
import { toProblem } from '../../../packages/contracts/src/errors.ts';
import type { ErrorCode } from '../../../packages/contracts/src/tools.ts';
import {ErrorCodeSchema} from '../../../packages/contracts/src/tools.ts';
import {z} from 'zod';import {timingSafeEqual} from 'node:crypto';
import type {PilotService} from './pilot/service.ts';import {PilotError} from './pilot/error.ts';import {readApiJson,readApiBody} from './pilot/body.ts';
import {SpeechTaskCreateSchema} from '../../../packages/contracts/src/speech-task.ts';
import{QuestionVoiceRequestSchema}from'../../../packages/contracts/src/tts.ts';
export function createApiApp(service: 'api' | 'agent' = 'api',options:{pilot?:PilotService;internalToken?:string}={}) {
  const app = new Hono<{Variables:{userId:string}}>();
  app.get('/health', (c) => c.json({ service, stage: options.pilot?'pilot':'scaffold', liveModelConfigured: false,
    capabilities: options.pilot?['authenticated-workbench','sqlite-formal-workflows','student-speech-broker']:service === 'agent' ? ['offline-pi-spike', 'draft-seed-knowledge'] : ['health-only'] }));
  if(options.pilot){
   const pilot=options.pilot;let active=0;
   app.use('/v1/*',async(c,next)=>{if(active>=8)throw new PilotError('RATE_LIMITED');active++;
    try{c.header('Cache-Control','no-store');if(c.req.path!=='/v1/auth/login')c.set('userId',pilot.authenticate(c.req.header('authorization')??null));await next();}
    finally{active--;if(c.req.raw.body&&!c.req.raw.bodyUsed)void c.req.raw.body.cancel().catch(()=>{});}});
   app.post('/v1/auth/login',async c=>c.json(pilot.login(await readApiJson(c.req.raw))));
   app.post('/v1/auth/logout',c=>{pilot.logout(c.req.header('authorization')??null);return c.json({ok:true});});
   app.get('/v1/roles',c=>c.json(pilot.roles()));
   app.get('/v1/interviews',c=>c.json(pilot.listSessions(c.get('userId'))));
   app.post('/v1/interviews',async c=>c.json(pilot.createSession(c.get('userId'),await readApiJson(c.req.raw)),202));
   app.get('/v1/interviews/:id',c=>c.json(pilot.getSession(c.get('userId'),c.req.param('id'))));
   app.post('/v1/interviews/:id/question',async c=>c.json(pilot.nextQuestion(c.get('userId'),c.req.param('id'),await readApiJson(c.req.raw)),202));
   app.post('/v1/interviews/:id/answers',async c=>c.json(pilot.submitAnswer(c.get('userId'),c.req.param('id'),await readApiJson(c.req.raw)),202));
   app.post('/v1/interviews/:id/completion',async c=>c.json(pilot.completeSession(c.get('userId'),c.req.param('id'),await readApiJson(c.req.raw)),202));
   app.get('/v1/operations/:id',c=>c.json(pilot.getOperation(c.get('userId'),c.req.param('id'))));
   app.post('/v1/interviews/:id/speech',async c=>c.json(await pilot.createSpeech(c.get('userId'),c.req.param('id'),await readApiJson(c.req.raw)),201));
   app.put('/v1/speech/:id/audio',async c=>{if((c.req.header('content-type')??'').split(';')[0]?.trim().toLowerCase()!=='audio/wav')throw new PilotError('VALIDATION_ERROR');
    pilot.speechRecord(c.get('userId'),c.req.param('id'));return c.json(await pilot.uploadSpeech(c.get('userId'),c.req.param('id'),await readApiBody(c.req.raw,4194304)),202);});
   app.get('/v1/speech/:id',async c=>c.json(await pilot.getSpeech(c.get('userId'),c.req.param('id'))));
   app.post('/v1/speech/:id/confirmation',async c=>c.json(await pilot.confirmSpeech(c.get('userId'),c.req.param('id'),await readApiJson(c.req.raw))));
   app.post('/v1/speech/:id/cancellation',async c=>c.json(await pilot.cancelSpeech(c.get('userId'),c.req.param('id')),202));
   app.get('/v1/interviews/:id/question-audio',async c=>{const audio=await pilot.questionAudio(c.get('userId'),c.req.param('id'),c.req.query('questionId')??'');
    return new Response(new Uint8Array(audio).buffer,{headers:{'content-type':'audio/wav','cache-control':'no-store'}});});
   app.get('/v1/evidence/status',c=>c.json(pilot.evidenceStatus()));
   if(options.internalToken){
    if(!/^[A-Za-z0-9_-]{32,256}$/.test(options.internalToken))throw Error('Invalid internal token');
    app.post('/internal/v1/speech/authorization',async c=>{const expected=Buffer.from(`Bearer ${options.internalToken}`),actual=Buffer.from(c.req.header('authorization')??'');
     if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new PilotError('UNAUTHENTICATED');
     const p=z.object({operation:z.enum(['create','read','upload','confirm','cancel']),request:SpeechTaskCreateSchema}).strict().safeParse(await readApiJson(c.req.raw));
     if(!p.success)throw new PilotError('VALIDATION_ERROR');return c.json({allowed:pilot.authorizeSpeech(p.data)});});
    app.post('/internal/v1/voice/authorization',async c=>{const expected=Buffer.from(`Bearer ${options.internalToken}`),actual=Buffer.from(c.req.header('authorization')??'');
     if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new PilotError('UNAUTHENTICATED');
     const p=QuestionVoiceRequestSchema.safeParse(await readApiJson(c.req.raw));if(!p.success)throw new PilotError('VALIDATION_ERROR');return c.json({allowed:pilot.authorizeVoice(p.data)});});
   }
  }
  app.notFound((c) => {
    const code: ErrorCode = c.req.path.startsWith('/v1/') || c.req.path.startsWith('/internal/v1/') ? 'NOT_IMPLEMENTED' : 'NOT_FOUND';
    const problem = toProblem(code, crypto.randomUUID());
    return new Response(JSON.stringify(problem), { status: problem.status, headers: { 'content-type': 'application/problem+json' } });
  });
  app.onError((error) => {
    const code=ErrorCodeSchema.safeParse((error as {code?:unknown}).code);
    const problem = toProblem(code.success?code.data:error instanceof z.ZodError?'VALIDATION_ERROR':'INTERNAL_ERROR', crypto.randomUUID());
    return new Response(JSON.stringify(problem), { status: problem.status, headers: { 'content-type': 'application/problem+json' } });
  });
  return app;
}
