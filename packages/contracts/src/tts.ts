import {z} from 'zod';
import{RoleIdSchema}from'./tools.ts';
export const TtsConfigSchema=z.object({enabled:z.boolean(),endpoint:z.literal('https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation'),
 model:z.literal('qwen3-tts-flash'),voice:z.literal('Cherry'),credentialEnv:z.literal('INTERVIEW_BAILIAN_ASR_API_KEY')}).strict();
export const TtsInputSchema=z.object({text:z.string().trim().min(1).max(1000),operationId:z.string().min(1).max(160),deadlineAt:z.number().int().nonnegative()}).strict();
export type TtsInput=z.infer<typeof TtsInputSchema>;
export const QuestionVoiceRequestSchema=TtsInputSchema.extend({sessionId:z.string().min(1).max(80),userId:z.string().min(1).max(80),roleId:RoleIdSchema,questionId:z.string().min(1).max(100)}).strict();
