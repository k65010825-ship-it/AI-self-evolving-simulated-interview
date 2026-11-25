import {z} from 'zod';import {LocalMethodSchema} from './local-runtime.ts';
export const LocalProcessStageSchema=z.enum(['startup','rpc','input','output','shutdown','process']);
export const LocalProcessCodeSchema=z.enum(['BOOTSTRAP_STARTED','HOST_READY','STARTUP_FAILED','REQUEST_RECEIVED','INPUT_CLOSED','INPUT_INVALID',
 'OUTPUT_FAILED','OUTPUT_TIMEOUT','SHUTDOWN_STARTED','SHUTDOWN_COMPLETED','SHUTDOWN_FAILED','PROCESS_SPAWNED','PROCESS_EXIT','PROCESS_CLOSED',
 'PROCESS_ERROR','REQUEST_SENT','RESPONSE_RECEIVED','REQUEST_TIMEOUT','PIPE_ERROR','PROTOCOL_INVALID','FORCED_TERMINATION']);
export const LocalStartupFailureCodeSchema=z.enum(['LOCAL_PROFILE_BUSY','LOCAL_OWNER_LOST','LOCAL_SCHEMA_UNSUPPORTED','LOCAL_PATH_INVALID','LOCAL_CONFIG_INVALID','LOCAL_CLOCK_INVALID','LOCAL_DATA_INVALID','LOCAL_PROFILE_INVALID','LOCAL_SCHEMA_CONFLICT','LOCAL_SCHEMA_MISSING','LOCAL_BACKUP_INVALID','LOCAL_UPGRADE_VERIFICATION_FAILED','PROFILE_BINDING_MISMATCH']);
export const LocalRuntimeDiagnosticFrameSchema=z.object({type:z.literal('runtime-diagnostic'),schemaVersion:z.literal(1),
 stage:LocalProcessStageSchema,code:LocalProcessCodeSchema,method:LocalMethodSchema.optional(),failureCode:LocalStartupFailureCodeSchema.optional()}).strict();
export const LocalProcessDiagnosticSchema=z.object({source:z.enum(['client','runtime']),stage:LocalProcessStageSchema,code:LocalProcessCodeSchema,
 seq:z.number().int().positive(),elapsedMs:z.number().int().nonnegative(),method:LocalMethodSchema.optional(),failureCode:LocalStartupFailureCodeSchema.optional(),
 exitCode:z.number().int().min(-2147483648).max(4294967295).nullable().optional(),signal:z.enum(['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV']).nullable().optional()}).strict();
export const LocalProcessDiagnosticsSchema=z.object({schemaVersion:z.literal(1),events:z.array(LocalProcessDiagnosticSchema).max(64),discarded:z.number().int().nonnegative()}).strict();
export const LocalProcessFailureContextSchema=z.object({schemaVersion:z.literal(1),lastClient:LocalProcessDiagnosticSchema.nullable(),lastRuntime:LocalProcessDiagnosticSchema.nullable(),discarded:z.number().int().nonnegative()}).strict();
export type LocalProcessDiagnostic=z.infer<typeof LocalProcessDiagnosticSchema>;
export type LocalProcessFailureContext=z.infer<typeof LocalProcessFailureContextSchema>;
