import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {isAbsolute,join,normalize,relative,resolve} from 'node:path';
import {
 CONTENT_PACK_RUNTIME_VERSION,
 ContentPackFailureCodeSchema,
 ContentPackManifestSchema,
 ContentPackVerificationResultSchema,
 type ContentPackFailureCode,
 type ContentPackManifest,
 type ContentPackVerificationResult,
} from '../../../../packages/contracts/src/content-pack.ts';
import type {KnowledgeCatalogPin} from '../../../../packages/contracts/src/knowledge-catalog.ts';
import {KnowledgeCatalogPinSchema} from '../../../../packages/contracts/src/knowledge-catalog.ts';
import {KnowledgeWorkspaceSchema,type KnowledgeWorkspace} from '../../../../packages/contracts/src/knowledge-curation.ts';
import {ROLE_SKILL_CATALOG} from '../../../../packages/contracts/src/role-catalog.ts';
import type {RoleId} from '../../../../packages/contracts/src/tools.ts';
import {questionCatalogDigest,validCatalogPin} from '../../../../packages/interview-domain/src/question-eligibility.ts';
import {buildKnowledgeCatalog} from './curation.ts';

function failResult(input:{
 failureCode:ContentPackFailureCode;
 reasons:string[];
 packId?:string|null;
 packVersion?:string|null;
 authority?:'draft-preview'|'central-reviewed'|null;
 productionPublished?:boolean;
 verifiedFiles?:number;
 summary?:ContentPackVerificationResult['summary'];
 retainedFallback?:boolean;
}):ContentPackVerificationResult{
 return ContentPackVerificationResultSchema.parse({
  valid:false,
  packId:input.packId??null,
  packVersion:input.packVersion??null,
  authority:input.authority??null,
  productionPublished:input.productionPublished??false,
  retainedFallback:input.retainedFallback??true,
  failureCode:ContentPackFailureCodeSchema.parse(input.failureCode),
  reasons:input.reasons,
  verifiedFiles:input.verifiedFiles??0,
  summary:input.summary??null,
 });
}

function safeRelativePath(rel:string){
 if(!rel||isAbsolute(rel)||rel.includes('\0')||rel.includes('\\'))return false;
 const clean=normalize(rel);
 return clean!=='.'&&!clean.startsWith('..')&&!isAbsolute(clean)&&rel.split('/').every(seg=>seg!==''&&seg!=='.'&&seg!=='..');
}

async function resolveNoSymlink(realRoot:string,rel:string):Promise<string|null>{
 if(!safeRelativePath(rel))return null;
 let current=realRoot;
 for(const part of rel.split('/')){
  current=join(current,part);
  try{
   const st=await lstat(current);
   if(st.isSymbolicLink())return null;
  }catch(e){
   if((e as NodeJS.ErrnoException).code==='ENOENT')throw e;
   return null;
  }
 }
 const resolved=await realpath(current),diff=relative(realRoot,resolved);
 if(!diff||diff.startsWith('..')||isAbsolute(diff))return null;
 return resolved;
}

function sha256(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex');}

function readJsonArray(files:Map<string,string>,rel:string,required=false):unknown[]|null{
 const raw=files.get(rel);
 if(raw===undefined)return required?null:[];
 try{const v=JSON.parse(raw);return Array.isArray(v)?v:null;}catch{return null;}
}

function readJson(files:Map<string,string>,rel:string):unknown|null{
 const raw=files.get(rel);
 if(raw===undefined)return null;
 try{return JSON.parse(raw);}catch{return null;}
}

type VerifiedLoad={
 verification:ContentPackVerificationResult;
 loaded?:{manifest:ContentPackManifest;workspace:KnowledgeWorkspace;catalog:ReturnType<typeof buildKnowledgeCatalog>};
};

async function verifyAndLoad(
 rootDir:string,
 options:{runtimeVersion?:string;requireProductionReady?:boolean;now?:number}={},
):Promise<VerifiedLoad>{
 const runtimeVersion=options.runtimeVersion??CONTENT_PACK_RUNTIME_VERSION,now=options.now??Date.now();
 let realRoot:string;
 try{
  const rootStat=await lstat(resolve(rootDir));
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink())return{verification:failResult({failureCode:'PATH_UNSAFE',reasons:['Content pack root must be a non-symlink directory']})};
  realRoot=await realpath(resolve(rootDir));
 }catch{
  return{verification:failResult({failureCode:'MISSING_FILE',reasons:['Content pack directory not found']})};
 }

 let manifestRaw:unknown;
 try{
  const manifestPath=await resolveNoSymlink(realRoot,'manifest.json');
  if(!manifestPath)return{verification:failResult({failureCode:'PATH_UNSAFE',reasons:['Unsafe manifest.json path or symlink']})};
  manifestRaw=JSON.parse(await readFile(manifestPath,'utf8'));
 }catch(e){
  if((e as NodeJS.ErrnoException).code==='ENOENT')return{verification:failResult({failureCode:'MISSING_FILE',reasons:['manifest.json missing']})};
  return{verification:failResult({failureCode:'MANIFEST_INVALID',reasons:['manifest.json unreadable or invalid JSON']})};
 }

 const parsedManifest=ContentPackManifestSchema.safeParse(manifestRaw);
 if(!parsedManifest.success)return{verification:failResult({failureCode:'MANIFEST_INVALID',reasons:parsedManifest.error.issues.map(i=>i.message)})};
 const manifest=parsedManifest.data;
 const baseMeta={packId:manifest.packId,packVersion:manifest.packVersion,authority:manifest.authority,productionPublished:manifest.productionPublished};

 if(!manifest.compatibleRuntimeVersions.includes(runtimeVersion))
  return{verification:failResult({...baseMeta,failureCode:'RUNTIME_INCOMPATIBLE',reasons:[`Runtime ${runtimeVersion} not in ${manifest.compatibleRuntimeVersions.join(',')}`]})};

 const fileText=new Map<string,string>();
 for(const entry of manifest.files){
  let safePath:string|null;
  try{
   safePath=await resolveNoSymlink(realRoot,entry.relativePath);
  }catch{
   return{verification:failResult({...baseMeta,failureCode:'MISSING_FILE',reasons:[`Missing file: ${entry.relativePath}`],verifiedFiles:fileText.size})};
  }
  if(!safePath)return{verification:failResult({...baseMeta,failureCode:'PATH_UNSAFE',reasons:[`Unsafe file path: ${entry.relativePath}`],verifiedFiles:fileText.size})};
  let bytes:Buffer;
  try{bytes=await readFile(safePath);}catch{return{verification:failResult({...baseMeta,failureCode:'MISSING_FILE',reasons:[`Unreadable file: ${entry.relativePath}`],verifiedFiles:fileText.size})};}
  if(bytes.byteLength!==entry.byteLength||sha256(bytes)!==entry.sha256)
   return{verification:failResult({...baseMeta,failureCode:'DIGEST_MISMATCH',reasons:[`Digest/size mismatch for ${entry.relativePath}`],verifiedFiles:fileText.size})};
  fileText.set(entry.relativePath,bytes.toString('utf8'));
 }

 const sources=readJson(fileText,'sources.json'),dossiers=readJsonArray(fileText,'dossiers.json',true),reviews=readJsonArray(fileText,'reviews.json',false);
 const javaSeed=readJsonArray(fileText,'java-backend/seed.json',false),javaExp=readJsonArray(fileText,'java-backend/expansion.json',false);
 const webSeed=readJsonArray(fileText,'web-frontend/seed.json',false),webExp=readJsonArray(fileText,'web-frontend/expansion.json',false);
 if(!sources||!dossiers||!reviews||!javaSeed||!javaExp||!webSeed||!webExp)
  return{verification:failResult({...baseMeta,failureCode:'WORKSPACE_INVALID',reasons:['Workspace JSON arrays/sources invalid or missing'],verifiedFiles:fileText.size})};
 const items=[...javaSeed,...javaExp,...webSeed,...webExp];
 if(!items.length)return{verification:failResult({...baseMeta,failureCode:'WORKSPACE_INVALID',reasons:['Content pack contains zero knowledge items'],verifiedFiles:fileText.size})};

 const parsedWs=KnowledgeWorkspaceSchema.safeParse({items,sources,dossiers,reviews,now});
 if(!parsedWs.success)return{verification:failResult({...baseMeta,failureCode:'WORKSPACE_INVALID',reasons:parsedWs.error.issues.map(i=>i.message),verifiedFiles:fileText.size})};
 const workspace:KnowledgeWorkspace=parsedWs.data;

 const catalogMode=manifest.authority==='central-reviewed'?'reviewed-only' as const:'draft-preview' as const;
 let catalog:ReturnType<typeof buildKnowledgeCatalog>;
 try{
  catalog=buildKnowledgeCatalog(workspace,{mode:catalogMode});
 }catch(e){
  return{verification:failResult({...baseMeta,failureCode:'CURATION_INVALID',reasons:[e instanceof Error?e.message:'CURATION_INVALID'],verifiedFiles:fileText.size})};
 }
 const summary=catalog.summary;

 for(const roleId of ['java-backend','web-frontend'] as const){
  const def=ROLE_SKILL_CATALOG[roleId],skills=[...def.mainSkills,...def.behavioralSkills];
  for(const skill of skills){
   if(!workspace.items.some(i=>i.roleId===roleId&&i.skillId===skill.skillId))
    return{verification:failResult({...baseMeta,failureCode:'ROLE_CATALOG_INVALID',reasons:[`Missing skill coverage ${roleId}:${skill.skillId}`],verifiedFiles:fileText.size,summary})};
  }
 }

 if((manifest.productionPublished||options.requireProductionReady)&&(manifest.authority!=='central-reviewed'||summary.reviewed===0))
  return{verification:failResult({...baseMeta,failureCode:'PRODUCTION_UNREVIEWED',reasons:['Production/reviewed content pack cannot publish unreviewed draft items'],verifiedFiles:fileText.size,summary})};

 if(summary.total!==manifest.reviewSummary.total||summary.readyForHumanReview!==manifest.reviewSummary.readyForHumanReview||
    summary.reviewed!==manifest.reviewSummary.reviewed||summary.returned!==manifest.reviewSummary.returned)
  return{verification:failResult({...baseMeta,failureCode:'REVIEW_SUMMARY_MISMATCH',reasons:['Manifest reviewSummary does not match computed curation summary'],verifiedFiles:fileText.size,summary})};

 const verification=ContentPackVerificationResultSchema.parse({
  valid:true,
  ...baseMeta,
  retainedFallback:false,
  failureCode:null,
  reasons:[],
  verifiedFiles:manifest.files.length,
  summary,
 });
 return{verification,loaded:{manifest,workspace,catalog}};
}

export async function verifyContentPack(
 rootDir:string,
 options:{runtimeVersion?:string;requireProductionReady?:boolean;now?:number}={},
):Promise<ContentPackVerificationResult>{
 return (await verifyAndLoad(rootDir,options)).verification;
}

export async function loadVerifiedContentPack(options:{
 packDir?:string;
 roleId:RoleId;
 fallbackPin:KnowledgeCatalogPin;
 runtimeVersion?:string;
 requireProductionReady?:boolean;
 now?:number;
}):Promise<{verified:boolean;catalogPin:KnowledgeCatalogPin;retainedFallback:boolean;verification:ContentPackVerificationResult}>{
 if(!options.packDir){
  const verification=failResult({failureCode:'MISSING_FILE',reasons:['No content pack directory configured']});
  return{verified:false,catalogPin:options.fallbackPin,retainedFallback:true,verification};
 }
 const {verification,loaded}=await verifyAndLoad(options.packDir,{
  ...(options.runtimeVersion?{runtimeVersion:options.runtimeVersion}:{}),
  ...(options.requireProductionReady!==undefined?{requireProductionReady:options.requireProductionReady}:{}),
  ...(options.now!==undefined?{now:options.now}:{}),
 });
 if(!verification.valid||!loaded)return{verified:false,catalogPin:options.fallbackPin,retainedFallback:true,verification};

 const {manifest,catalog}=loaded;
 const items=catalog.items.filter(q=>q.roleId===options.roleId&&(manifest.authority!=='central-reviewed'||q.reviewStatus==='reviewed'))
  .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(!items.length){
  return{verified:false,catalogPin:options.fallbackPin,retainedFallback:true,verification:failResult({
   failureCode:'PRODUCTION_UNREVIEWED',reasons:['No eligible items for role after verification'],
   packId:manifest.packId,packVersion:manifest.packVersion,authority:manifest.authority,productionPublished:manifest.productionPublished,summary:verification.summary,
  })};
 }
 const mode=manifest.authority==='central-reviewed'?'reviewed-only' as const:'draft-preview' as const;
 const draft=KnowledgeCatalogPinSchema.parse({schemaVersion:1,id:'pending',roleId:options.roleId,mode,digest:'0'.repeat(64),items});
 const digest=questionCatalogDigest(draft);
 const catalogPin={...draft,id:`catalog-${mode}-${digest.slice(0,20)}`,digest};
 if(!validCatalogPin(catalogPin))return{verified:false,catalogPin:options.fallbackPin,retainedFallback:true,verification:failResult({failureCode:'WORKSPACE_INVALID',reasons:['Derived catalog pin invalid']})};
 return{verified:true,catalogPin,retainedFallback:false,verification};
}
