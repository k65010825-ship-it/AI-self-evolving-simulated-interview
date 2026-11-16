import {serveLocalStdio} from './stdio.ts';
try{
 const args=process.argv.slice(2),values=new Map<string,string>();
 for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--data-dir','--assets-root','--lease-ms'].includes(key)||!value||values.has(key))throw Error();values.set(key,value);}
 const dataDir=values.get('--data-dir'),assetsRoot=values.get('--assets-root');if(!dataDir||!assetsRoot)throw Error();
 await serveLocalStdio({dataDir,assetsRoot,...(values.has('--lease-ms')?{leaseMs:Number(values.get('--lease-ms'))}:{})});
}catch{process.stderr.write('LOCAL_STARTUP_FAILED\n');process.stdin.destroy();process.exitCode=1;}
