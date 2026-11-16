import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCatalogReviewBundle, fieldEvidenceReadiness } from '../evals/field-evidence/catalog.ts';
import { createReviewBundle, evaluateReviews, evaluateCohort, importKnowledgeReview, type ReviewBundle } from '../evals/field-evidence/index.ts';
async function read(path:string):Promise<unknown>{if((await stat(path)).size>20_000_000)throw new Error('FIELD_EVIDENCE_FILE_TOO_LARGE');return JSON.parse(await readFile(path,'utf8'));}
const write=(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export async function fieldEvidenceCli(args:string[]):Promise<number>{
 const [command,...paths]=args;
 if(command==='readiness'&&paths.length===0){console.log(JSON.stringify(fieldEvidenceReadiness()));return 2;}
 if(command==='catalog'&&paths.length===1){const b=createCatalogReviewBundle();await mkdir(paths[0]!);await write(join(paths[0]!,'private-manifest.json'),b);await write(join(paths[0]!,'review-packet.json'),b.reviewPacket);await write(join(paths[0]!,'labels.json'),[]);await write(join(paths[0]!,'knowledge-label-template.json'),b.privateManifest.tasks.map(t=>({taskId:t.taskId,taskDigest:t.taskDigest,reviewId:null,reviewerId:null,reviewedAt:null,decision:null,checks:{technicalAccuracy:null,scoringClarity:null,sourceAlignment:null,roleFit:null},note:null})));console.log(JSON.stringify({output:paths[0],tasks:b.privateManifest.tasks.length,status:'awaiting_independent_review',authority:b.authority,productionPublished:false}));return 0;}
 if(command==='export'&&paths.length===2){const b=createReviewBundle(await read(paths[0]!));await mkdir(paths[1]!);await write(join(paths[1]!,'private-manifest.json'),b);await write(join(paths[1]!,'review-packet.json'),b.reviewPacket);await write(join(paths[1]!,'labels.json'),[]);await write(join(paths[1]!,'knowledge-label-template.json'),b.privateManifest.tasks.filter(t=>t.item.kind==='knowledge').map(t=>({taskId:t.taskId,taskDigest:t.taskDigest,reviewId:null,reviewerId:null,reviewedAt:null,decision:null,checks:{technicalAccuracy:null,scoringClarity:null,sourceAlignment:null,roleFit:null},note:null})));console.log(JSON.stringify({output:paths[1],tasks:b.reviewPacket.tasks.length,authority:b.authority,productionPublished:false}));return 0;}
 if(command==='reviews'&&paths.length===3){const report=evaluateReviews(await read(paths[0]!) as ReviewBundle,await read(paths[1]!));await write(paths[2]!,report);console.log(JSON.stringify(report));return report.status==='passed'?0:2;}
 if(command==='knowledge'&&paths.length===3){const proposal=importKnowledgeReview(await read(paths[0]!) as ReviewBundle,await read(paths[1]!));await write(paths[2]!,proposal);console.log(JSON.stringify({output:paths[2],productionPublished:false,catalogUpdated:false}));return 0;}
 if(command==='cohort'&&paths.length===2){const report=evaluateCohort(await read(paths[0]!));await write(paths[1]!,report);console.log(JSON.stringify(report));return report.status==='ready_descriptive'?0:2;}
 throw new Error('Usage: field-evidence.ts catalog <new-directory> | readiness | export <input.json> <new-directory> | reviews <private-manifest.json> <labels.json> <new-report.json> | knowledge <private-manifest.json> <review.json> <new-proposal.json> | cohort <cohort.json> <new-report.json>');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.exitCode=await fieldEvidenceCli(process.argv.slice(2));}catch(error){console.error(error instanceof Error?error.message:'FIELD_EVIDENCE_FAILED');process.exitCode=1;}}

