import {pathToFileURL} from 'node:url';
import {readFile,stat} from 'node:fs/promises';
import example from '../apps/agent/src/speech/qianwen-omni.example.json' with {type:'json'};
import {preflightAsr} from '../apps/agent/src/speech/bailian-asr.ts';
/** Deliberately has no --execute switch and never resolves credential environment variables. */
export async function asrPreflightMain(args:string[]){
 if(!(args.length===0||(args.length===2&&args[0]==='--config')))throw Error('ASR_ARGUMENTS_INVALID');
 let raw:unknown=example;
 if(args.length){const info=await stat(args[1]!);if(!info.isFile()||info.size>65536)throw Error('ASR_CONFIG_INVALID');
  const bytes=await readFile(args[1]!);if(bytes.length>65536)throw Error('ASR_CONFIG_INVALID');raw=JSON.parse(bytes.toString('utf8'));}
 const result=preflightAsr(raw);console.log(JSON.stringify(result));return result.configValid?0:2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.exitCode=await asrPreflightMain(process.argv.slice(2));}catch{console.error('ASR_PREFLIGHT_FAILED');process.exitCode=2;}
}
