const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { createInterface } = require('node:readline/promises');
const { Writable } = require('node:stream');
const valid = require('../lib/validation');
async function main() {
  const cloud = process.argv.includes('--cloud');
  const file = cloud ? '.env.cloud' : '.env';
  if (fs.existsSync(file)) { console.log(file+' already exists; settings were not overwritten. Keep it to preserve passwords and sessions.'); return; }
  let hidden = false;
  const output = new Writable({write(chunk,encoding,done){if(!hidden)process.stdout.write(chunk);done();}});
  const rl = createInterface({ input:process.stdin, output, terminal:!!process.stdin.isTTY });
  async function ask(label, fallback='', secret=false){
    process.stdout.write(label+(fallback?' ['+fallback+']':'')+': ');hidden=secret;
    const value = await rl.question('');hidden=false;if(secret)process.stdout.write('\n');return value||fallback;
  }
  const settings = { JWT_SECRET:process.env.JWT_SECRET || randomBytes(32).toString('hex'), PORT:'3000' };
  let adminExists=false;
  try {
    if(cloud){
      const domain=await ask('Public domain (for example air.example.com)');
      if(!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain)||domain.includes('..'))throw Error('Enter a domain name without https:// or a path');
      settings.DOMAIN=domain.toLowerCase();settings.TRUST_PROXY='1';
      settings.DB_HOST='db';settings.DB_USER='airwatch';settings.DB_NAME='smart_air_db';
      settings.DB_PASSWORD=randomBytes(24).toString('hex');settings.MYSQL_ROOT_PASSWORD=randomBytes(32).toString('hex');
    }else{
      settings.DB_HOST=await ask('Database host','127.0.0.1');settings.DB_PORT=await ask('Database port','3306');
      settings.DB_USER=await ask('Database user','root');settings.DB_NAME=await ask('Database name','smart_air_db');
      settings.DB_PASSWORD=await ask('Database password (blank if Laragon has no password)','',true);
    }
    if(!cloud){
      if (!/^[A-Za-z0-9_]+$/.test(settings.DB_NAME)) throw Error('Database name must use letters, digits and underscores');
      const mysql=require('mysql2');const db=mysql.createConnection({host:settings.DB_HOST,port:Number(settings.DB_PORT),user:settings.DB_USER,password:settings.DB_PASSWORD});
      try{
        const {query}=require('../lib/database');
        await query(db, 'CREATE DATABASE IF NOT EXISTS `'+settings.DB_NAME+'`');
        await query(db, 'USE `'+settings.DB_NAME+'`');
        await require('../db/migrate').migrate(db);
        const [adminCount]=await query(db, "SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
        adminExists=Number(adminCount.count)>0;
        const devices=await query(db,'SELECT id,device_name FROM devices ORDER BY id');
        if(devices.length>1){console.log('Existing boards:');devices.forEach(d=>console.log(d.id+' — '+d.device_name));const id=await ask('ID of the one board to use');if(!devices.some(d=>String(d.id)===id))throw Error('Unknown board');settings.SINGLE_DEVICE_ID=id;}
      }finally{db.end();}
    }
    if(!adminExists) {
    settings.ADMIN_USERNAME=await ask('Administrator name','admin1');
    settings.ADMIN_EMAIL=await ask('Administrator email');
    const password=await ask('Administrator password (12+ characters, hidden)','',true);
    const confirm=await ask('Repeat password','',true);
    if(!valid.text(settings.ADMIN_USERNAME,3,50)||!valid.email(settings.ADMIN_EMAIL)||!valid.password(password)||password!==confirm)throw Error('Invalid account details or passwords do not match');
    settings.ADMIN_PASSWORD_B64=Buffer.from(password).toString('base64');
    } else console.log('Existing administrator preserved; use your existing email and password.');
    const env=Object.entries(settings).map(([key,value])=>{if(/[\r\n']/.test(value))throw Error('Settings cannot contain newlines or single quotes');return key+"='"+value+"'";}).join('\n')+'\n';
    fs.writeFileSync(file,env,{flag:'wx',mode:0o600});
    console.log('Saved '+file+'. Keep it private and back it up; it contains credentials.');
    console.log(cloud?'Next: docker compose --env-file .env.cloud up -d --build':'Next: npm start (or double-click Start-AirWatch.cmd)');
  }finally{rl.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
