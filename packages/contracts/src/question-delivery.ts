import{z}from'zod';
import{ToolContextSchema}from'./tools.ts';
import{InterviewStateSchema}from'./interview-state.ts';
import{QuestionSelectionSchema}from'./question-selection.ts';
import{TurnInputSchema}from'./evaluation.ts';
export const QuestionDeliveryModeSchema=z.enum(['canonical','natural-bridge']);
export const BridgeModelOutputSchema=z.object({bridge:z.string().trim().min(1).max(120),excerpt:z.string().min(1).max(80)}).strict().refine(v=>
 !/[?？\r\n`<>\x00-\x1f]/.test(v.bridge)&&!/^(?:\s*)请|请(?:你|您|先|再|继续|进一步|详细|简要|解释|说明|给出|回答|实现|证明|计算|分析|举例)|你需要|建议|答案|解析|应该|必须|为什么|如何|怎么|解释|证明|计算|实现|得分|分数|满分|不及格|答对|答错|正确|错误|https?:|please|explain|implement|score|correct/i.test(v.bridge),'Bridge must be a neutral declarative surface.');
export const BridgeGenerationRequestSchema=z.object({promptVersion:z.literal('question-delivery-v1'),
 previousAnswerText:z.string().min(1).max(10000),nextQuestion:z.object({text:z.string().min(1).max(4000),skillId:z.string().min(1),
  difficulty:z.number().int().min(1).max(5),questionType:z.string().min(1)}).strict(),
 state:z.object({action:z.enum(['deepen','switch_skill','adjust_difficulty']),remainingSeconds:z.number().int().nonnegative(),
  mastery:z.number().min(0).max(1).nullable(),confidence:z.number().min(0).max(1)}).strict()}).strict();
export const QuestionDeliveryInputSchema=z.object({context:ToolContextSchema,state:InterviewStateSchema,
 previousAnswer:TurnInputSchema.shape.answer,selection:QuestionSelectionSchema,wrapUpSeconds:z.number().int().min(0).max(300).default(30)}).strict().superRefine((i,ctx)=>{
 let invalid=i.context.roleId!==i.state.roleId;
 if(i.selection.status==='selected'){const s=i.selection,q=s.question;
  invalid||=q.roleId!==i.state.roleId||s.rubric.roleId!==i.state.roleId||s.plan.action==='finish'||s.plan.skillId!==q.skillId
   ||s.source.knowledgeId!==q.id||s.rubric.id!==q.id||s.rubric.version!==s.source.version||!i.state.skills.some(k=>k.skillId===q.skillId);
 }
 if(invalid)ctx.addIssue({code:'custom',message:'Host selection binding mismatch.'});
});
export const QuestionDeliverySchema=z.object({kind:z.literal('uncommitted-question-delivery'),question:TurnInputSchema.shape.question,
 basedOn:z.object({runId:ToolContextSchema.shape.runId,attemptId:ToolContextSchema.shape.attemptId,sessionId:z.string().min(1),
  stateVersion:z.number().int().nonnegative(),previousAnswerId:z.string().min(1),rubricId:z.string().min(1),rubricVersion:z.string().min(1),
  sourceVersion:z.string().min(1)}).strict(),status:z.enum(['generated','canonical']),
 reason:z.enum(['generated','disabled','time-budget','call-budget','invalid-output']),bridge:z.string().max(120).nullable(),excerpt:z.string().max(80).nullable(),
 text:z.string().min(1).max(4200),semanticReview:z.enum(['pending','not-applicable'])}).strict().superRefine((r,ctx)=>{
 const generated=r.status==='generated';
 if(generated?(r.reason!=='generated'||!r.bridge||r.bridge!==r.bridge.trim()||!r.excerpt||!BridgeModelOutputSchema.safeParse({bridge:r.bridge,excerpt:r.excerpt}).success||!r.bridge.includes(r.excerpt)||r.semanticReview!=='pending'
   ||r.text!==r.bridge+'\n'+r.question.text):r.reason==='generated'||r.bridge!==null||r.excerpt!==null||r.semanticReview!=='not-applicable'||r.text!==r.question.text)
  ctx.addIssue({code:'custom',message:'Delivery must preserve its canonical question.'});
});
export type BridgeGenerationRequest=z.infer<typeof BridgeGenerationRequestSchema>;
export type QuestionDeliveryInput=z.infer<typeof QuestionDeliveryInputSchema>;
export type QuestionDelivery=z.infer<typeof QuestionDeliverySchema>;
export type BridgeGenerator=(request:BridgeGenerationRequest,signal:AbortSignal)=>Promise<unknown>;
