import {spawn} from 'node:child_process';import {isAbsolute} from 'node:path';
import type {LocalCredentialResolver} from './credential-broker.ts';
import {bindLocalProcess,LocalAgentClientError} from './connection.ts';
import type {LocalProcessDiagnostic} from '../../contracts/src/local-process.ts';
export {LocalAgentClientError} from './connection.ts';
export async function spawnLocalAgent(options:{executable:string;entry:string;dataDir:string;assetsRoot:string;cwd:string;timeoutMs?:number;resolveCredential?:LocalCredentialResolver;onDiagnostic?:(event:LocalProcessDiagnostic)=>void}){
 for(const p of [options.executable,options.entry,options.dataDir,options.assetsRoot,options.cwd])if(!isAbsolute(p))throw new LocalAgentClientError('LOCAL_PATH_INVALID');
 const env:NodeJS.ProcessEnv={};for(const key of ['SystemRoot','WINDIR','ComSpec','TEMP','TMP','OS','PATHEXT'])if(process.env[key])env[key]=process.env[key];
 const child=spawn(options.executable,['--no-env-file',options.entry,'--data-dir',options.dataDir,'--assets-root',options.assetsRoot],{cwd:options.cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
 return bindLocalProcess(child,options);
}
