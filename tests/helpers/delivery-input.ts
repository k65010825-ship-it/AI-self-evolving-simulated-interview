import{acceptanceSample}from'../../evals/live-bailian/samples.ts';
import{QuestionDeliveryInputSchema}from'../../packages/contracts/src/question-delivery.ts';
export function deliveryInput(){const now=Date.now(),r=acceptanceSample('java-backend',now,now+60000);if(r.job.type!=='turn')throw Error('turn');
 const p=QuestionDeliveryInputSchema.parse({context:r.context,state:r.job.input.state,previousAnswer:r.job.input.answer,selection:{status:'selected',
  plan:{action:'switch_skill',skillId:r.job.input.question.skillId,difficulty:r.job.input.question.difficulty,remainingSeconds:1200,reason:'host'},
  question:r.job.input.question,rubric:r.job.input.rubric,source:{knowledgeId:r.job.input.question.id,version:r.job.input.rubric.version,sourceIds:['s'],reviewStatus:'draft'}}});
 if(p.selection.status!=='selected')throw Error('selected');return{...p,selection:p.selection};
}
