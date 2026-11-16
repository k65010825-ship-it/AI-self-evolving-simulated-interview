import {readFile,stat} from 'node:fs/promises';import {join} from 'node:path';import {z} from 'zod';
import {createPilotService} from '../api/src/pilot/service.ts';import {createPilotGateway} from '../api/src/pilot/gateway.ts';import{createApiApp}from'../api/src/app.ts';
import {openSessionAccounting} from '../agent/src/accounting/session-ledger.ts';import {fieldEvidenceReadiness} from '../../evals/field-evidence/catalog.ts';import type {PilotConfig} from './config.ts';
export async function createPilotApi(config:PilotConfig,agentUrl:string){const info=await stat(config.usersFile);if(info.size>65536)throw Error('Account file too large');
 const users=z.array(z.object({userId:z.string().min(1).max(80),name:z.string().min(1).max(80),password:z.string().min(12).max(256)}).strict()).min(1).max(100).parse(JSON.parse(await readFile(config.usersFile,'utf8')));
 const gateway=createPilotGateway({agentUrl,internalToken:config.internalToken}),ledger=openSessionAccounting(join(config.stateDir,'accounting.sqlite'));
 const service=createPilotService({path:join(config.stateDir,'api.sqlite'),users,evidenceMode:config.mode==='live'?'live-model':'offline-fixture',allowDraftKnowledge:config.allowDraftKnowledge,
  ...gateway,onSession:s=>{ledger.ensureSession({...s,currency:'CNY',...config.budget});},evidenceStatus:()=>fieldEvidenceReadiness()});
 const app=createApiApp('api',{pilot:service,internalToken:config.internalToken});return{app,service,ledger,close(){service.close();ledger.close();}};
}
