import {expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {CONTENT_PACK_RUNTIME_VERSION} from '../packages/contracts/src/content-pack.ts';
import {resolvePinnedCatalog} from '../apps/agent/src/knowledge/catalog.ts';
import {loadVerifiedContentPack,verifyContentPack} from '../apps/agent/src/knowledge/verify-content-pack.ts';

const PACK_FILES=[
 'sources.json',
 'dossiers.json',
 'reviews.json',
 'java-backend/seed.json',
 'java-backend/expansion.json',
 'web-frontend/seed.json',
 'web-frontend/expansion.json',
];

async function createPackFromRepo(overrides:{
 authority?:'draft-preview'|'central-reviewed';
 productionPublished?:boolean;
 compatibleRuntimeVersions?:string[];
 reviewSummary?:{total:number;readyForHumanReview:number;reviewed:number;returned:number};
 reviews?:unknown[];
}={}){
 const dir=await mkdtemp(join(tmpdir(),'content-pack-'));
 const entries=[];
 for(const rel of PACK_FILES){
  const dst=join(dir,rel);
  await mkdir(join(dst,'..'),{recursive:true});
  let bytes=await readFile(resolve('knowledge',rel));
  if(rel==='reviews.json'&&overrides.reviews!==undefined)bytes=Buffer.from(JSON.stringify(overrides.reviews,null,2));
  await writeFile(dst,bytes);
  entries.push({relativePath:rel,sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.byteLength});
 }
 const manifest={
  schemaVersion:1,
  packId:'pack-local-test',
  packVersion:'1.0.0',
  createdAt:Date.now(),
  compatibleRuntimeVersions:overrides.compatibleRuntimeVersions??[CONTENT_PACK_RUNTIME_VERSION],
  authority:overrides.authority??'draft-preview',
  productionPublished:overrides.productionPublished??false,
  reviewSummary:overrides.reviewSummary??{total:29,readyForHumanReview:22,reviewed:0,returned:29},
  files:entries,
 };
 await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
 return{dir,manifest};
}

test('validates honest draft-preview content pack and materializes catalog pin',async()=>{
 const {dir}=await createPackFromRepo();
 const fallback=resolvePinnedCatalog('java-backend','seed');
 try{
  const result=await verifyContentPack(dir);
  expect(result.valid).toBe(true);
  expect(result.retainedFallback).toBe(false);
  expect(result.productionPublished).toBe(false);
  expect(result.summary).toEqual({total:29,readyForHumanReview:22,reviewed:0,returned:29});
  const loaded=await loadVerifiedContentPack({packDir:dir,roleId:'java-backend',fallbackPin:fallback});
  expect(loaded.verified).toBe(true);
  expect(loaded.retainedFallback).toBe(false);
  expect(loaded.catalogPin.id).toStartWith('catalog-draft-preview-');
  expect(loaded.catalogPin.digest).not.toBe(fallback.digest);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('rejects digest tamper, missing file, runtime mismatch, summary inflation, and unreviewed publication while retaining fallback pin',async()=>{
 const fallback=resolvePinnedCatalog('web-frontend','seed');

 // 1. Tampered file digest
 const p1=await createPackFromRepo();
 try{
  await writeFile(join(p1.dir,'sources.json'),'{}');
  const loaded=await loadVerifiedContentPack({packDir:p1.dir,roleId:'web-frontend',fallbackPin:fallback});
  expect(loaded.verified).toBe(false);
  expect(loaded.retainedFallback).toBe(true);
  expect(loaded.verification.failureCode).toBe('DIGEST_MISMATCH');
  expect(loaded.catalogPin).toEqual(fallback);
 }finally{await rm(p1.dir,{recursive:true,force:true});}

 // 2. Missing file
 const p2=await createPackFromRepo();
 try{
  await rm(join(p2.dir,'dossiers.json'));
  const r=await verifyContentPack(p2.dir);
  expect(r.valid).toBe(false);
  expect(r.failureCode).toBe('MISSING_FILE');
  expect(r.retainedFallback).toBe(true);
 }finally{await rm(p2.dir,{recursive:true,force:true});}

 // 3. Runtime incompatible
 const p3=await createPackFromRepo({compatibleRuntimeVersions:['local-runtime-v999']});
 try{
  const r=await verifyContentPack(p3.dir);
  expect(r.valid).toBe(false);
  expect(r.failureCode).toBe('RUNTIME_INCOMPATIBLE');
 }finally{await rm(p3.dir,{recursive:true,force:true});}

 // 4. Inflated reviewSummary
 const p4=await createPackFromRepo({reviewSummary:{total:29,readyForHumanReview:22,reviewed:5,returned:29}});
 try{
  const r=await verifyContentPack(p4.dir);
  expect(r.valid).toBe(false);
  expect(r.failureCode).toBe('REVIEW_SUMMARY_MISMATCH');
 }finally{await rm(p4.dir,{recursive:true,force:true});}

 // 5. Unreviewed pack claiming productionPublished=true
 const p5=await createPackFromRepo({authority:'central-reviewed',productionPublished:true});
 try{
  const r=await verifyContentPack(p5.dir);
  expect(r.valid).toBe(false);
  expect(r.failureCode).toBe('PRODUCTION_UNREVIEWED');
 }finally{await rm(p5.dir,{recursive:true,force:true});}

 // 6. Path traversal
 const p6=await createPackFromRepo();
 try{
  const bad={...p6.manifest,files:[...p6.manifest.files,{relativePath:'../outside.json',sha256:'a'.repeat(64),byteLength:2}]};
  await writeFile(join(p6.dir,'manifest.json'),JSON.stringify(bad));
  const r=await verifyContentPack(p6.dir);
  expect(r.valid).toBe(false);
  expect(r.failureCode).toBe('PATH_UNSAFE');
 }finally{await rm(p6.dir,{recursive:true,force:true});}

 // 7. Symlink / junction escape check (when OS allows symlinks)
 const p7=await createPackFromRepo();
 const outside=join(p7.dir,'..','outside-secret.json');
 try{
  await writeFile(outside,'[]');
  let linkCreated=true;
  try{
   await rm(join(p7.dir,'reviews.json'));
   await symlink(outside,join(p7.dir,'reviews.json'));
  }catch(e){
   if((e as NodeJS.ErrnoException).code==='EPERM'){linkCreated=false;}else throw e;
  }
  if(linkCreated){
   const r=await verifyContentPack(p7.dir);
   expect(r.valid).toBe(false);
   expect(r.failureCode).toBe('PATH_UNSAFE');
  }
 }finally{await rm(p7.dir,{recursive:true,force:true});await rm(outside,{force:true});}
});
