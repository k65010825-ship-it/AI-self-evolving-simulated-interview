import {readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {resolve,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
/** These isolated tests create flat SQLite-only directories. Never recurse or follow links. */
export function removeAccountingTemp(dir:string){
 const absolute=resolve(dir),root=resolve(tmpdir());
 if(!absolute.startsWith(root+sep))throw Error('TEST_TEMP_OUTSIDE_ROOT');
 const files=readdirSync(absolute,{withFileTypes:true});
 if(files.some(file=>!file.isFile()))throw Error('TEST_TEMP_NOT_FLAT');
 for(const file of files)unlinkSync(join(absolute,file.name));rmdirSync(absolute);
}
