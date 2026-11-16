import type {JsonIssue,OutputRepairPolicy,JsonStructureDetail} from '../../../../packages/contracts/src/evaluation-diagnostic.ts';
type Result={ok:true;value:unknown;repaired:boolean}|{ok:false;jsonIssue:JsonIssue};
/** Called only after JSON.parse succeeds. Decoded key identity catches escaped duplicates too. */
function duplicateKey(text:string){
 const stack:({kind:'object';keys:Set<string>;expectKey:boolean}|{kind:'array'})[]=[];
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){
   let end=i+1;while(end<text.length){if(text[end]==='\\'){end+=2;continue;}if(text[end]==='"')break;end++;}
   const frame=stack.at(-1);if(frame?.kind==='object'&&frame.expectKey){const key=JSON.parse(text.slice(i,end+1))as string;
    if(frame.keys.has(key))return true;frame.keys.add(key);frame.expectKey=false;}
   i=end;continue;
  }
  if(c==='{')stack.push({kind:'object',keys:new Set(),expectKey:true});
  else if(c==='[')stack.push({kind:'array'});
  else if(c==='}'||c===']')stack.pop();
  else if(c===','){const frame=stack.at(-1);if(frame?.kind==='object')frame.expectKey=true;}
 }
 return false;
}
/** Diagnostic structure scan only; it never completes or repairs malformed input. */
function structure(text:string){
 const stack:string[]=[];let quoted=false,escaped=false,mismatch=false,firstEnd=-1;
 for(let i=0;i<text.length;i++){const c=text[i]!;
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;continue;}if(c==='{'||c==='[')stack.push(c);
  else if(c==='}'||c===']'){if(stack.pop()!==(c==='}'?'{':'[')){mismatch=true;break;}if(!stack.length&&firstEnd<0)firstEnd=i;}
 }
 return {unclosed:!mismatch&&(quoted||stack.length>0),firstEnd,mismatch,quoted,escaped,depth:stack.length};
}
/** A shape description is not syntax validation or a repair recipe. No input data is returned. */
export function describeEvaluationJsonShape(text:string):JsonStructureDetail{
 const trimmed=text.trim(),fence=/^```json\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed),body=fence?fence[1]!:trimmed,s=structure(body),first=body.trimStart()[0];
 const root:JsonStructureDetail['root']=first===undefined?'empty':first==='{'?'object':first==='['?'array':first==='"'?'string':/[-\dtfn]/.test(first)?'scalar':'unknown';
 return {scope:fence?'single-json-fence':'raw',root,containers:s.mismatch?'mismatched':s.depth>0?'open':'balanced',
  stringState:s.quoted?(s.escaped?'dangling-escape':'open'):'closed',openDepth:s.mismatch?'unknown':s.depth===0?'zero':s.depth===1?'one':'two-plus',
  trailing:!s.mismatch&&(root==='object'||root==='array')&&s.firstEnd>=0?(body.slice(s.firstEnd+1).trim()?'present':'none'):'unknown'};
}
/** Preserve raw values. Only one explicit, complete json fence may be removed. No eval or prose extraction. */
export function readEvaluationJson(text:string,policy:OutputRepairPolicy='none'):Result{
 let value:unknown;
 try{value=JSON.parse(text);return duplicateKey(text)?{ok:false,jsonIssue:'duplicate-key'}:{ok:true,value,repaired:false};}catch{/* Never expose parser messages or model text. */}
 const trimmed=text.trim(),fence=/^```json\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
 if(fence){
  if(policy!=='json-fence-only')return {ok:false,jsonIssue:'fence-disabled'};
  const inner=fence[1]!;try{value=JSON.parse(inner);}catch{return {ok:false,jsonIssue:'fenced-syntax'};}
  if(!value||typeof value!=='object'||Array.isArray(value))return {ok:false,jsonIssue:'non-object-root'};
  if(duplicateKey(inner))return {ok:false,jsonIssue:'duplicate-key'};
  return {ok:true,value,repaired:true};
 }
 if(/^```json\r?\n/.test(trimmed))return {ok:false,jsonIssue:/\r?\n```/.test(trimmed.slice(trimmed.indexOf('\n')+1))?'surrounding-content':'unclosed-fence'};
 if(trimmed.startsWith('```'))return {ok:false,jsonIssue:'unsupported-fence'};
 if(trimmed.includes('```'))return {ok:false,jsonIssue:'surrounding-content'};
 const scan=structure(trimmed);
 if(scan.firstEnd>=0&&trimmed.slice(scan.firstEnd+1).trim())return {ok:false,jsonIssue:'surrounding-content'};
 if(!/^(?:\{|\[|"|\d|-|t|f|n)/.test(trimmed)&&/[{\[]/.test(trimmed))return {ok:false,jsonIssue:'surrounding-content'};
 return {ok:false,jsonIssue:scan.unclosed?'unclosed-structure':'invalid-syntax'};
}
