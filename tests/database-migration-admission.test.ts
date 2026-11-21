import {describe,test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {fileURLToPath} from 'node:url';
import {assertManagementMigrationState} from '../packages/db/src/migration-admission.ts';
import {applyLocalSchemaSandbox} from '../packages/local-db/src/sandbox.ts';

describe('migration admission preserves legacy databases and live profiles',()=>{
 test('operator command without explicit database configuration refuses without connecting',async()=>{
  const child=Bun.spawn([process.execPath,'--no-env-file',fileURLToPath(new URL('../packages/db/src/migrate.ts',import.meta.url))],{env:{},stdout:'pipe',stderr:'pipe'});
  const [code,stderr]=await Promise.all([child.exited,new Response(child.stderr).text()]);
  expect(code).toBe(1);expect(stderr.trim()).toBe('DATABASE_URL_REQUIRED');
 });
 test('management baseline accepts empty DB and a matching applied prefix',()=>{
  expect(()=>assertManagementMigrationState({tables:[],migrationHashes:[]},['h0','h1'])).not.toThrow();
  expect(()=>assertManagementMigrationState({tables:['app_user','job_role'],migrationHashes:['h0']},['h0','h1'])).not.toThrow();
 });
 test('management migration rejects legacy and mismatched histories',()=>{
  expect(()=>assertManagementMigrationState({tables:['interview_session','app_user'],migrationHashes:['old']},['h0'])).toThrow('LEGACY_DATABASE_REQUIRES_EXPLICIT_UPGRADE');
  expect(()=>assertManagementMigrationState({tables:['app_user'],migrationHashes:['different']},['h0'])).toThrow('MIGRATION_HISTORY_MISMATCH');
  expect(()=>assertManagementMigrationState({tables:['app_user'],migrationHashes:[]},['h0'])).toThrow('NONEMPTY_DATABASE_WITHOUT_MATCHING_HISTORY');
  expect(()=>assertManagementMigrationState({tables:[],migrationHashes:['h0','h1']},['h0'])).toThrow('MIGRATION_HISTORY_MISMATCH');
 });
 test('sandbox initializes only a blank SQLite database',()=>{
  const db=new Database(':memory:');try{applyLocalSchemaSandbox(db);expect(db.query("select name from sqlite_master where name='interview_turn'").get()).not.toBeNull();
   expect(()=>applyLocalSchemaSandbox(db)).toThrow('LOCAL_SCHEMA_SANDBOX_REQUIRES_EMPTY_DATABASE');
  }finally{db.close();}
 });
 test('v3 profile is refused before any mutation',()=>{
  const db=new Database(':memory:');try{db.exec('CREATE TABLE local_control(id INTEGER PRIMARY KEY); PRAGMA user_version=3; INSERT INTO local_control VALUES(1)');
   expect(()=>applyLocalSchemaSandbox(db)).toThrow('LOCAL_PROFILE_REQUIRES_HOST_MIGRATION');
   expect(db.query('PRAGMA user_version').get()).toEqual({user_version:3});
   expect(db.query('SELECT * FROM local_control').all()).toEqual([{id:1}]);
   expect(db.query("select name from sqlite_master where name='interview_session'").get()).toBeNull();
  }finally{db.close();}
 });
 test('unversioned nonempty DB is also refused',()=>{
  const db=new Database(':memory:');try{db.exec('CREATE TABLE important_data(id INTEGER)');
   expect(()=>applyLocalSchemaSandbox(db)).toThrow('LOCAL_SCHEMA_SANDBOX_REQUIRES_EMPTY_DATABASE');
  }finally{db.close();}
 });
});
