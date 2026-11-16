import{test,expect}from'bun:test';import{mkdtempSync,readFileSync,readdirSync,unlinkSync,rmdirSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
test('CLI collects only explicitly consented stdin, resumes and refuses premature blind export',()=>{
 const parent=mkdtempSync(join(tmpdir(),'field-cli-')),dir=join(parent,'study');
 const run=(args:string[],input?:string)=>Bun.spawnSync([process.execPath,'--no-env-file','run','scripts/agent-field.ts',...args],{cwd:process.cwd(),...(input?{stdin:Buffer.from(input)}:{}),env:{PATH:process.env.PATH!,SystemRoot:process.env.SystemRoot??'C:\\Windows'}});
 try{expect(run(['prepare',dir,'synthetic-test-only']).exitCode).toBe(0);
  expect(run(['collect',dir,'java-backend'],'不同意\n').exitCode).toBe(2);
  const collected=run(['collect',dir,'java-backend'],'同意\n纯自动测试回答，不是真人验收样本。\n/done\n/quit\n');expect(collected.exitCode).toBe(0);
  expect(new TextDecoder().decode(collected.stdout)).not.toMatch(/keyPoints|rubric|modelScore/);
  const status=run(['status',dir]);expect(JSON.parse(new TextDecoder().decode(status.stdout)).humanAnswers).toBe(1);
  expect(run(['export',dir]).exitCode).toBe(1);
 }finally{for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);rmdirSync(parent);}
},30000);
