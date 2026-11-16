import {EvaluationDiagnosticSchema,type EvaluationDiagnostic,type EvaluationDiagnosticSink}from'../../../../packages/contracts/src/evaluation-diagnostic.ts';
/** Observability must never alter scoring or leak dependency error messages. */
export function diagnose(sink:EvaluationDiagnosticSink|undefined,stage:EvaluationDiagnostic['stage'],outcome:EvaluationDiagnostic['outcome'],reason:EvaluationDiagnostic['reason'],schemaIssue?:EvaluationDiagnostic['schemaIssue'],detail?:Pick<EvaluationDiagnostic,'quoteIssue'|'bindingIssue'|'jsonIssue'|'jsonShape'|'bindingConflict'|'wireCompletion'|'candidateIssue'>) {
 if(!sink)return;
 try{sink(Object.freeze(EvaluationDiagnosticSchema.parse({version:1,stage,outcome,reason,...(schemaIssue?{schemaIssue}:{}),...detail})));}catch{/* callback failures are not model failures */}
}
