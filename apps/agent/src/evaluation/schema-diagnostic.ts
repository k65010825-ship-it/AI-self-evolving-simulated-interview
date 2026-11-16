import {EvaluationOutputSchema} from '../../../../packages/contracts/src/evaluation.ts';
import {SchemaIssueDetailSchema,SchemaIssueFieldSchema} from '../../../../packages/contracts/src/evaluation-diagnostic.ts';
import type {z} from 'zod';
type Detail=z.infer<typeof SchemaIssueDetailSchema>;
/** Project only bounded, fixed categories. Never persist Zod messages, keys or input values. */
export function schemaFailureDetails(value:unknown,schema:z.ZodType=EvaluationOutputSchema):Detail[]{
 const parsed=schema.safeParse(value);if(parsed.success)return [];
 const details:Detail[]=[];
 for(const issue of parsed.error.issues){
  const path=issue.path.filter(p=>typeof p!=='number').map(String).join('.');
  const normalized=path.replace(/verificationBinding\.(?:action|target|expectation|observation\.(?:metric|value|condition))(?=\.|$)/,'verificationBinding.span');
  const f=SchemaIssueFieldSchema.safeParse(normalized||'root');
  let current:unknown=value;
  for(const part of issue.path){
   if(!current||typeof current!=='object'){current=undefined;break;}
   const descriptor=Object.getOwnPropertyDescriptor(current,part);
   current=descriptor&&'value' in descriptor?descriptor.value:undefined;
  }
  const receivedType:Detail['receivedType']=current===undefined?'missing':current===null?'null':Array.isArray(current)?'array':
   typeof current==='string'?'string':typeof current==='number'?'number':typeof current==='boolean'?'boolean':typeof current==='object'?'object':'other';
  const code=SchemaIssueDetailSchema.shape.issue.safeParse(issue.code);
  const detail:Detail={field:f.success?f.data:'other',issue:code.success?code.data:'other',receivedType};
  if(!details.some(d=>JSON.stringify(d)===JSON.stringify(detail)))details.push(detail);
  if(details.length===4)break;
 }
 return details;
}
