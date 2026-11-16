import type {Database} from 'bun:sqlite';
import {Database as SQLite} from 'bun:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,writeFileSync,readFileSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {dirname,join} from 'node:path';
function check(path:string){for(let at=path;;){if(existsSync(at)&&lstatSync(at).isSymbolicLink())throw Error('LOCAL_PATH_INVALID');const parent=dirname(at);if(parent===at)break;at=parent;}}
export function migrateLocalProfile(db:Database,profileDir:string,profileId:string,version:number){
 if(version===1||version===2){
  const dir=join(profileDir,'backups');check(dir);mkdirSync(dir,{recursive:true});check(dir);
  const path=join(dir,`v${version}-${randomUUID()}.sqlite`);check(path);
  // SQLite serializes this connection's complete image, including committed WAL pages.
  const bytes=db.serialize();writeFileSync(path,bytes,{flag:'wx',mode:0o600});const fd=openSync(path,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}
  const copy=new SQLite(path,{readonly:true,strict:true});try{
   if((copy.query('PRAGMA integrity_check').get() as {integrity_check:string}).integrity_check!=='ok'||(copy.query('PRAGMA user_version').get() as {user_version:number}).user_version!==version)throw Error('LOCAL_BACKUP_INVALID');
  }finally{copy.close();}
  const digest=createHash('sha256').update(readFileSync(path)).digest('hex');
  writeFileSync(path+'.json',JSON.stringify({profileId,schemaVersion:version,digest,path})+'\n',{flag:'wx',mode:0o600});
 }
 db.exec(`
 CREATE TABLE IF NOT EXISTS local_session_budgets(session_id TEXT PRIMARY KEY,body TEXT NOT NULL,grant_version INTEGER NOT NULL DEFAULT 0,current_grant TEXT);
 CREATE TABLE IF NOT EXISTS local_live_grants(grant_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS local_model_checkpoints(job_id TEXT NOT NULL,run_id TEXT NOT NULL,attempt_id TEXT NOT NULL,session_id TEXT NOT NULL,grant_id TEXT NOT NULL,snapshot TEXT NOT NULL,profile TEXT NOT NULL,PRIMARY KEY(run_id,attempt_id));
 CREATE TABLE IF NOT EXISTS local_live_reconciliations(run_id TEXT NOT NULL,attempt_id TEXT NOT NULL,call_id TEXT NOT NULL,digest TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(run_id,attempt_id,call_id));
 CREATE TABLE IF NOT EXISTS local_resource_budgets(session_id TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS local_speech_grants(grant_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,capability TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,owner TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS local_speech_grant_versions(session_id TEXT NOT NULL,capability TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(session_id,capability));
 CREATE TABLE IF NOT EXISTS local_speech_attempts(call_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS local_speech_reconciliations(call_id TEXT PRIMARY KEY,digest TEXT NOT NULL,receipt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS local_speech_tasks(job_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS local_speech_links(job_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,confirmation_id TEXT NOT NULL,digest TEXT NOT NULL);
 PRAGMA user_version=3;
 `);
}
