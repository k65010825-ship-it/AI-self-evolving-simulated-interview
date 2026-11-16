import {mkdir,mkdtemp,copyFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
/** Windows sidecar artifact, not an Electron installer. No credentials or user files are copied. */
export async function buildLocalAgent(){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('LOCAL_BUILD_PLATFORM_UNSUPPORTED');
 const root=resolve('.cache/local-agent-build');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'本地 agent-'));await mkdir(join(output,'assets'));
 const result=await Bun.build({entrypoints:[resolve('apps/agent/src/local/index.ts')],outdir:output,target:'bun',format:'esm',naming:'runtime.js',minify:false});
 if(!result.success)throw Error('LOCAL_BUILD_FAILED');await copyFile(resolve('node_modules/@oven/bun-windows-x64/bin/bun.exe'),join(output,'bun.exe'));
 const files=[];for(const name of ['runtime.js','bun.exe'])files.push({name,sha256:createHash('sha256').update(Buffer.from(await Bun.file(join(output,name)).arrayBuffer())).digest('hex')});
 await writeFile(join(output,'assets','manifest.json'),JSON.stringify({version:1,mode:'local-runtime',defaultSessionMode:'offline-fixture',protocolVersion:1,profileSchemaVersion:3,knowledge:'embedded-versioned-development-seed',files},null,2)+'\n',{flag:'wx'});
 return{output,executable:join(output,'bun.exe'),entry:join(output,'runtime.js'),assetsRoot:join(output,'assets')};
}
if(import.meta.main){try{console.log(JSON.stringify(await buildLocalAgent()));}catch{console.error('LOCAL_BUILD_FAILED');process.exitCode=1;}}
