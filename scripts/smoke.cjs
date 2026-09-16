// Integration check for the isolated CI stack, never production data.
const assert=require('node:assert/strict');
(async()=>{
 const base='http://127.0.0.1:3000';
 const call=async(path,{token,body,key}={})=>{
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...(key?{'X-Device-Key':key}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,data:await r.json()};};
 const login=await call('/api/auth/login',{body:{email:'smoke@example.invalid',password:'smoke-private-password'}});assert.equal(login.status,200);const token=login.data.token;
 const board=await call('/api/device',{token});assert.equal(board.status,200);assert.ok(board.data.id);
 const key=await call('/api/device/key',{token});assert.equal(key.status,200);assert.equal(key.data.device_key.length,48);
 const sample={in_pm:22,in_co2:null,in_gas:1400,out_pm:null,out_gas:null,vent:0,filt:0,temp:27.5,humidity:56};
 assert.equal((await call('/api/log',{body:sample,key:key.data.device_key})).status,201);
 const latest=await call('/api/latest',{token});assert.equal(latest.data.device_id,board.data.id);assert.equal(latest.data.in_co2,null);assert.equal(latest.data.temperature,27.5);
 assert.equal((await call('/api/latest')).status,401);
 const history=await call('/api/history/daily',{token});assert.equal(history.status,200);assert.ok(history.data.length);
 console.log('Fresh stack automatically migrated, created admin/board, authenticated and stored telemetry.');
})().catch(e=>{console.error(e);process.exitCode=1;});
