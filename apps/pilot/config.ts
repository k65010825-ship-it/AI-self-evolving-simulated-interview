import {z} from 'zod';import {readFile,stat} from 'node:fs/promises';
import {LiveServiceConfigSchema} from '../../packages/contracts/src/live-model.ts';
export const PilotConfigSchema=z.object({version:z.literal(1),mode:z.enum(['offline-fixture','live']),stateDir:z.string().min(1),usersFile:z.string().min(1),
 internalToken:z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),apiPort:z.number().int().min(0).max(65535),agentPort:z.number().int().min(0).max(65535),
 allowDraftKnowledge:z.boolean(),expressionEnabled:z.boolean(),model:LiveServiceConfigSchema,
 budget:z.object({maxCostMicros:z.number().int().min(100000).max(10000000),maxCalls:z.number().int().min(1).max(200),maxConcurrent:z.number().int().min(1).max(4)}).strict(),
}).strict();
export type PilotConfig=z.infer<typeof PilotConfigSchema>;
export async function readPilotConfig(path:string){const info=await stat(path);if(!info.isFile()||info.size>65536)throw Error('Invalid pilot config');const bytes=await readFile(path);if(bytes.length>65536)throw Error('Invalid pilot config');return PilotConfigSchema.parse(JSON.parse(bytes.toString('utf8')));}
