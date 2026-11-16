import {z} from 'zod';

/** Private stdio capability. These frames are never public RPC results or events. */
export const LOCAL_CREDENTIAL_CAPABILITY='credential-broker-v1' as const;
const id=z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
export const LocalCredentialBindingSchema=z.object({grantId:id,credentialRef:id,expiresAt:z.number().int().nonnegative()}).strict();
const correlation={protocolVersion:z.literal(1),requestId:z.uuid(),grantId:id,credentialRef:id};
export const LocalCredentialRequestSchema=z.object({...correlation,type:z.literal('credential-request')}).strict();
export const LocalCredentialCancelSchema=z.object({...correlation,type:z.literal('credential-cancel')}).strict();
export const LocalCredentialErrorCodeSchema=z.enum(['CREDENTIAL_UNAVAILABLE','CREDENTIAL_TIMEOUT','CREDENTIAL_CANCELLED','CREDENTIAL_CLOSED','CREDENTIAL_REVOKED','CREDENTIAL_INVALID','CREDENTIAL_RATE_LIMITED','CREDENTIAL_NOT_NEGOTIATED']);
export const LocalCredentialResponseSchema=z.discriminatedUnion('ok',[
 z.object({...correlation,type:z.literal('credential-response'),ok:z.literal(true),secret:z.string().min(1).max(8192).regex(/\S/)}).strict(),
 z.object({...correlation,type:z.literal('credential-response'),ok:z.literal(false),error:z.object({code:LocalCredentialErrorCodeSchema}).strict()}).strict(),
]);
export type LocalCredentialBinding=z.infer<typeof LocalCredentialBindingSchema>;
export type LocalCredentialRequest=z.infer<typeof LocalCredentialRequestSchema>;
export type LocalCredentialCancel=z.infer<typeof LocalCredentialCancelSchema>;
export type LocalCredentialResponse=z.infer<typeof LocalCredentialResponseSchema>;
export type LocalCredentialErrorCode=z.infer<typeof LocalCredentialErrorCodeSchema>;
export class LocalCredentialError extends Error{constructor(readonly code:LocalCredentialErrorCode){super(code);}}
