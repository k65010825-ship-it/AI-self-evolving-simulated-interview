import {BindingSpanConflictSchema,type BindingSpanConflict} from '../../contracts/src/verification-binding.ts';
/** Called after range/overlap validation. Returned labels are checked against fixed host fields. */
export function describeSpanConflict(parts:readonly [string,string],a:{start:number;end:number},b:{start:number;end:number}):BindingSpanConflict{
 const relation=a.start===b.start&&a.end===b.end?'identical':a.start<=b.start&&a.end>=b.end?'contains':a.start>=b.start&&a.end<=b.end?'contained-by':'partial-overlap';
 return BindingSpanConflictSchema.parse({parts:[...parts],relation});
}
