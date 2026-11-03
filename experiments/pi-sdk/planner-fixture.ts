import{createEvaluationFixture}from'./evaluation-fixture.ts';
import type{TranscriptContext}from'@earendil-works/pi-ai';
export const contentText=(content:string|{type:string;text?:string}[])=>typeof content==='string'?content:content.filter(c=>c.type==='text').map(c=>c.text??'').join('');
export function plannerReply(context:TranscriptContext){
 const last=context.messages.filter(m=>m.role==='toolResult').at(-1);
 if(last){const receipt=JSON.parse(contentText(last.content));return{text:JSON.stringify({questionId:receipt.data?.items[0]?.id??null})};}
 const user=context.messages.filter(m=>m.role==='user').at(-1)!;
 const input=JSON.parse(contentText(user.content));
 return{text:'',stopReason:'toolUse' as const,toolCalls:[{type:'toolCall' as const,id:'query-1',name:'query_role_knowledge',arguments:{skillId:input.plan.skillId,limit:3}}]};
}
export const createPlannerFixture=()=>createEvaluationFixture(plannerReply);
