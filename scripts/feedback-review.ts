import {exportFeedbackReview} from '../evals/quality-batch/feedback-review.ts';
try{
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--batch')throw Error();
 console.log(JSON.stringify(await exportFeedbackReview(args[1]!)));
}catch{console.error('FEEDBACK_REVIEW_FAILED');process.exitCode=2;}
