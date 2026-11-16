import {Database} from 'bun:sqlite';
import {migrateLocalProfile} from './migration.ts';
import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
export class LocalError extends Error {constructor(readonly code:string){super(code);}}
const fail=(code:string):never=>{throw new LocalError(code);};
function checkAncestors(path:string){let at=path;for(;;){if(existsSync(at)&&lstatSync(at).isSymbolicLink())fail('LOCAL_PATH_INVALID');const parent=dirname(at);if(parent===at)break;at=parent;}}
function contains(parent:string,child:string){const r=relative(parent,child);return r===''||(!r.startsWith('..')&&!isAbsolute(r));}
export function localPaths(dataDir:string,assetsRoot:string){
 if(!isAbsolute(dataDir)||!isAbsolute(assetsRoot))fail('LOCAL_PATH_INVALID');const data=resolve(dataDir),assets=resolve(assetsRoot);
 checkAncestors(data);checkAncestors(assets);if(contains(data,assets)||contains(assets,data)||!existsSync(assets)||!lstatSync(assets).isDirectory())fail('LOCAL_PATH_INVALID');
 const profile=join(data,'agent','profiles','default');checkAncestors(profile);mkdirSync(profile,{recursive:true});checkAncestors(profile);
 return{dataDir:data,assetsRoot:assets,profile,path:join(profile,'profile.sqlite')};
}
type Control={owner:string;fence:number;lease_until:number;profile_id:string;last_time:number};
export function openLocalProfile(options:{dataDir:string;assetsRoot:string;now?:()=>number;leaseMs?:number}){
 const paths=localPaths(options.dataDir,options.assetsRoot),clock=options.now??Date.now,leaseMs=options.leaseMs??30000,owner=randomUUID();
 if(!Number.isInteger(leaseMs)||leaseMs<1||leaseMs>120000)fail('LOCAL_CONFIG_INVALID');checkAncestors(paths.path);
 const db=new Database(paths.path,{create:true,strict:true});let closed=false,fence=0,profileId='';
 const time=()=>{const t=clock();if(!Number.isSafeInteger(t)||t<0)fail('LOCAL_CLOCK_INVALID');return t;};
 try{
  const version=(db.query('PRAGMA user_version').get() as {user_version:number}).user_version;
  if(version>3||version<0)fail('LOCAL_SCHEMA_UNSUPPORTED');
  if(version===0&&(db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()as {n:number}).n)fail('LOCAL_SCHEMA_UNSUPPORTED');
  db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  db.transaction(()=>{if(version===0)db.exec(`
   CREATE TABLE IF NOT EXISTS local_control(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,fence INTEGER NOT NULL,lease_until INTEGER NOT NULL,profile_id TEXT NOT NULL,last_time INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS local_sessions(session_id TEXT PRIMARY KEY,role_id TEXT NOT NULL,storage_version INTEGER NOT NULL,workflow TEXT,created_at INTEGER NOT NULL,deadline_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS local_memory(role_id TEXT PRIMARY KEY,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS local_jobs(job_id TEXT PRIMARY KEY,operation_id TEXT UNIQUE NOT NULL,session_id TEXT NOT NULL,role_id TEXT NOT NULL,digest TEXT NOT NULL,request TEXT NOT NULL,ticket TEXT NOT NULL,status TEXT NOT NULL,snapshot TEXT,receipt TEXT,error_code TEXT,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS local_events(job_id TEXT NOT NULL,seq INTEGER NOT NULL,event TEXT NOT NULL,PRIMARY KEY(job_id,seq));
   CREATE TABLE IF NOT EXISTS local_budget(attempt_id TEXT PRIMARY KEY,job_id TEXT NOT NULL,status TEXT NOT NULL,kind TEXT NOT NULL,reserved_cost INTEGER NOT NULL,used_cost INTEGER,usage TEXT);
   PRAGMA user_version=1;
  `);
  const at=time(),old=db.query('SELECT * FROM local_control WHERE id=1').get() as Control|null;
   if(old&&at<old.last_time)fail('LOCAL_CLOCK_INVALID');if(old&&old.lease_until>at)fail('PROFILE_BUSY');
   fence=(old?.fence??0)+1;profileId=old?.profile_id??randomUUID();
   const manifest=join(paths.profile,'manifest.json');checkAncestors(manifest);
   if(existsSync(manifest)){const m=JSON.parse(readFileSync(manifest,'utf8'));if(m.version!==1||typeof m.profileId!=='string'||!/^[a-f0-9-]{36}$/.test(m.profileId)||old&&m.profileId!==profileId)fail('LOCAL_MANIFEST_INVALID');if(!old)profileId=m.profileId;}
   else writeFileSync(manifest,JSON.stringify({version:1,profileId})+'\n',{flag:'wx'});
   db.query('INSERT INTO local_control VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,fence=excluded.fence,lease_until=excluded.lease_until,last_time=excluded.last_time').run(owner,fence,at+leaseMs,profileId,at);
   if(version<3)migrateLocalProfile(db,paths.profile,profileId,version);
   db.query("UPDATE local_budget SET status='unknown' WHERE status='dispatched'").run();
   db.query("UPDATE local_budget SET status='released' WHERE status='reserved'").run();
  }).immediate();
 }catch(e){db.close();throw e;}
 function guard(){if(closed)fail('PROFILE_CLOSED');const at=time(),c=db.query('SELECT * FROM local_control WHERE id=1').get() as Control;
  if(c.owner!==owner||c.fence!==fence||c.lease_until<=at)fail('PROFILE_FENCED');if(at<c.last_time)fail('LOCAL_CLOCK_INVALID');return at;}
 function sync<T>(fn:()=>T):T{const result=fn();if(result&&typeof(result as {then?:unknown}).then==='function'){void Promise.resolve(result).catch(()=>{});fail('LOCAL_ASYNC_TRANSACTION');}return result;}
 function write<T>(fn:(connection:Database)=>T):T{guard();return db.transaction(()=>{guard();const result=sync(()=>fn(db));const at=guard();db.query('UPDATE local_control SET last_time=? WHERE id=1').run(at);return result;}).immediate();}
 return{...paths,profileId,owner,fence,leaseMs,
  read:<T>(fn:(connection:Database)=>T)=>{guard();return sync(()=>fn(db));},write,
  renew:()=>write(connection=>connection.query('UPDATE local_control SET lease_until=? WHERE id=1').run(time()+leaseMs)),
  close(){if(closed)return;try{db.query('UPDATE local_control SET lease_until=0 WHERE id=1 AND owner=? AND fence=?').run(owner,fence);}finally{closed=true;db.close();}},
 };
}
export type LocalProfile=ReturnType<typeof openLocalProfile>;
