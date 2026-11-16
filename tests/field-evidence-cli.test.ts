import { test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const run=(args:string[])=>Bun.spawnSync([process.execPath,'run','scripts/field-evidence.ts',...args],{cwd:process.cwd()});
test('CLI exports empty blind package and writes not_ready report with nonzero gate exit',async()=>{const dir=await mkdtemp(join(tmpdir(),'field-evidence-'));const source=join(dir,'source.json');await writeFile(source,JSON.stringify({datasetId:'empty',developmentGroupIds:[],developmentReviewerIds:[],items:[]}));const out=join(dir,'packet');expect(run(['export',source,out]).exitCode).toBe(0);expect(JSON.parse(await readFile(join(out,'review-packet.json'),'utf8')).tasks).toEqual([]);const report=join(dir,'report.json');expect(run(['reviews',join(out,'private-manifest.json'),join(out,'labels.json'),report]).exitCode).toBe(2);expect(JSON.parse(await readFile(report,'utf8')).status).toBe('not_ready');expect(run(['export',source,out]).exitCode).toBe(1);});
test('CLI malformed import fails instead of writing a success artifact',async()=>{const dir=await mkdtemp(join(tmpdir(),'field-evidence-'));const source=join(dir,'source.json');await writeFile(source,'{}');expect(run(['cohort',source,join(dir,'out.json')]).exitCode).toBe(1);});
