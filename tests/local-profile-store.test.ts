import {test,expect} from 'bun:test';
import {mkdtemp,rm,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {Database} from 'bun:sqlite';
import {openLocalProfile} from '../apps/agent/src/local/profile-store.ts';
import {existsSync} from 'node:fs';
test('profile uses an explicit nonoverlapping absolute directory, one database and fenced ownership',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-profile-')),assets=join(root,'assets'),data=join(root,'user');await mkdir(assets);let now=1000;
 const p=openLocalProfile({dataDir:data,assetsRoot:assets,now:()=>now,leaseMs:100});
 try{expect(p.profileId).toMatch(/^[a-f0-9-]{36}$/);expect(p.path).toBe(join(data,'agent','profiles','default','profile.sqlite'));
  expect(()=>openLocalProfile({dataDir:data,assetsRoot:assets,now:()=>now,leaseMs:100})).toThrow('PROFILE_BUSY');
  p.write(db=>db.query("INSERT INTO local_memory(role_id,body) VALUES('java-backend','{}')").run());
  now=1101;const next=openLocalProfile({dataDir:data,assetsRoot:assets,now:()=>now,leaseMs:100});
  try{expect(next.profileId).toBe(p.profileId);expect(()=>p.write(()=>{})).toThrow('PROFILE_FENCED');expect(next.read(db=>db.query('SELECT COUNT(*) AS n FROM local_memory').get())).toEqual({n:1});}finally{next.close();}
 }finally{p.close();await rm(root,{recursive:true,force:true});}
});
test('a junction inside the profile path is rejected before creating any escaped directories',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-junction-')),data=join(root,'user'),outside=join(root,'outside'),assets=join(root,'assets');await mkdir(data);await mkdir(outside);await mkdir(assets);await symlink(outside,join(data,'agent'),'junction');
 try{expect(()=>openLocalProfile({dataDir:data,assetsRoot:assets})).toThrow('LOCAL_PATH_INVALID');expect(existsSync(join(outside,'profiles'))).toBe(false);}finally{await rm(root,{recursive:true,force:true});}
});
test('relative/overlapping/linked paths and newer schemas are refused without silently migrating data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-profile-path-')),assets=join(root,'assets'),data=join(root,'user');await mkdir(assets);
 try{expect(()=>openLocalProfile({dataDir:'relative',assetsRoot:assets})).toThrow('LOCAL_PATH_INVALID');expect(()=>openLocalProfile({dataDir:assets,assetsRoot:assets})).toThrow('LOCAL_PATH_INVALID');
  const dir=join(data,'agent','profiles','default');await mkdir(dir,{recursive:true});const db=new Database(join(dir,'profile.sqlite'));db.exec('PRAGMA user_version=99');db.close();
  expect(()=>openLocalProfile({dataDir:data,assetsRoot:assets})).toThrow('LOCAL_SCHEMA_UNSUPPORTED');
  await symlink(assets,join(root,'linked'),'junction');expect(()=>openLocalProfile({dataDir:join(root,'linked','user'),assetsRoot:assets})).toThrow('LOCAL_PATH_INVALID');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('expiry during a transaction rolls back writes; dispatched budget survives reopening as unknown',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-profile-fence-'));let now=1000;let p=openLocalProfile({dataDir:root,assetsRoot:process.cwd(),now:()=>now,leaseMs:100});
 try{expect(()=>p.write(db=>{db.query("INSERT INTO local_memory VALUES('java-backend','{}')").run();now=1101;})).toThrow('PROFILE_FENCED');
  p.close();p=openLocalProfile({dataDir:root,assetsRoot:process.cwd(),now:()=>now,leaseMs:100});expect(p.read(db=>db.query('SELECT COUNT(*) AS n FROM local_memory').get())).toEqual({n:0});
  p.write(db=>db.query("INSERT INTO local_budget VALUES('a','j','dispatched','llm',100,NULL,NULL)").run());p.close();p=openLocalProfile({dataDir:root,assetsRoot:process.cwd(),now:()=>now,leaseMs:100});
  expect(p.read(db=>db.query("SELECT status,reserved_cost FROM local_budget WHERE attempt_id='a'").get())).toEqual({status:'unknown',reserved_cost:100});
 }finally{p.close();await rm(root,{recursive:true,force:true});}
});
