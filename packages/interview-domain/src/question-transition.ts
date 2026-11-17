/** New generation boundary only. Archived committed presentation remains readable.
 * A quote existing in an answer does not authorize any other claim about the student.
 * Exact string composition avoids regex interpretation of student-controlled excerpts.
 */
export function isGroundedNeutralTransition(answer:string,bridge:string,excerpt:string):boolean {
 const first=answer.indexOf(excerpt);
 if(excerpt.length<2||first<0||answer.indexOf(excerpt,first+1)!==-1
   ||/[\r\n\x00-\x1f“”「」『』"<>`]/u.test(excerpt)
   ||/[\uD800-\uDBFF]$/u.test(excerpt)||/^[\uDC00-\uDFFF]/u.test(excerpt))return false;
 const prefixes=['你提到','你提到了','你刚才提到','你刚才提到了'];
 const tails=['。','，我们继续。','，我们接着往下看。','，我们继续往下看。',
  '，我们接着换个角度。','，接下来我们换个角度。','，我们换个方向继续。'];
 return prefixes.some(prefix=>tails.some(tail=>bridge===prefix+'“'+excerpt+'”'+tail||bridge===prefix+excerpt+tail));
}
