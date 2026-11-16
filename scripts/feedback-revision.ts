import {writeFeedbackRevisionDemo,replayFeedbackRevisionDemo} from '../evals/feedback-revision/demo.ts';
try{
 const args=process.argv.slice(2);
 if(args.length===0)console.log(JSON.stringify(await writeFeedbackRevisionDemo()));
 else if(args.length===2&&args[0]==='--replay')console.log(JSON.stringify(await replayFeedbackRevisionDemo(args[1]!)));
 else throw Error();
}catch{console.error('FEEDBACK_REVISION_DEMO_FAILED');process.exitCode=2;}
