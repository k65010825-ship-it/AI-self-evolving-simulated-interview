import {writeAgentJourney,verifyAgentJourney} from '../evals/journey/index.ts';
try{
 const args=process.argv.slice(2);
 if(args.length===0)console.log(JSON.stringify(await writeAgentJourney()));
 else if(args.length===2&&args[0]==='--verify')console.log(JSON.stringify(await verifyAgentJourney(args[1]!)));
 else throw Error();
}catch{console.error('AGENT_JOURNEY_FAILED');process.exitCode=2;}
