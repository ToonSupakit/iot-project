const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn,spawnSync}=require('node:child_process');
test('cloud wizard writes stable private settings without exposing the password',{timeout:10000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'airwatch-setup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const script=path.resolve('scripts/configure.js');const child=spawn(process.execPath,[script,'--cloud'],{cwd:dir,env:{...process.env,JWT_SECRET:''},stdio:['pipe','pipe','pipe']});t.after(()=>child.kill());
 const prompts=['Public domain','Administrator name','Administrator email','Administrator password','Repeat password'];const answers=['airwatch.example.com','example-admin','admin@example.invalid','a-private-test-password','a-private-test-password'];let output='',errors='',index=0;
 child.stdout.on('data',chunk=>{output+=chunk;while(index<prompts.length&&output.includes(prompts[index]))child.stdin.write(answers[index++]+'\n');});child.stderr.on('data',c=>errors+=c);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});assert.equal(code,0,errors);assert.doesNotMatch(output,/a-private-test-password/);
 const saved=fs.readFileSync(path.join(dir,'.env.cloud'),'utf8');assert.match(saved,/DOMAIN='airwatch.example.com'/);assert.match(saved,/JWT_SECRET='[a-f0-9]{64}'/);assert.match(saved,/DB_HOST='db'/);
 const second=spawnSync(process.execPath,[script,'--cloud'],{cwd:dir,encoding:'utf8'});assert.equal(second.status,0);assert.equal(fs.readFileSync(path.join(dir,'.env.cloud'),'utf8'),saved);
});
