'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {pipeline}=require('node:stream/promises');
const {createGzip}=require('node:zlib');
const BASE='/data/recipe-intelligence-trial',APP='recipe-intelligence-trial-app-1',GATEWAY='recipe-intelligence-trial-gateway-1';
const ID='pc-backup-20261112',OUT=BASE+'/offline-backups/'+ID,EXPECTED='c0fd4d47849132a583458defdea83a3cb23addca';
function run(c,a){return execFileSync(c,a,{encoding:'utf8',maxBuffer:4*1024*1024}).trim();}
const docker=a=>run('docker',a),sleep=ms=>new Promise(r=>setTimeout(r,ms));
function info(name){return JSON.parse(docker(['inspect',name]))[0];}
function health(){try{return JSON.parse(docker(['exec',APP,'node','-e',"fetch('http://127.0.0.1:3000/api/server-health').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))"]));}catch{return null;}}
function inspect(){return JSON.parse(docker(['exec',APP,'node','scripts/deployment-workspace.cjs','inspect']));}
async function hash(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function encryptProcess(name,command,args){
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const wrapped=crypto.publicEncrypt({key:fs.readFileSync('maintenance/backup-recipient.pem'),oaepHash:'sha256'},key);
 const file=path.join(OUT,name+'.enc'),child=spawn(command,args,{stdio:['ignore','pipe','inherit']});
 const complete=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(command+' failed')));});
 try{await Promise.all([pipeline(child.stdout,createGzip({level:6}),cipher,fs.createWriteStream(file,{flags:'wx',mode:0o600})),complete]);}
 catch(error){child.kill('SIGTERM');throw error;}
 const meta={file:name+'.enc',algorithm:'AES-256-GCM',keyWrap:'RSA-OAEP-SHA256',wrappedKey:wrapped.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),bytes:fs.statSync(file).size,sha256:await hash(file)};
 fs.writeFileSync(file+'.json',JSON.stringify(meta,null,2),{flag:'wx',mode:0o600});key.fill(0);return meta;
}
async function main(){
 if(process.platform!=='linux'||process.env.GITHUB_REPOSITORY!=='salahkessab/track-compititor'||process.env.GITHUB_REF!=='refs/heads/codex/instabox-backup')throw Error('Wrong backup environment');
 if(fs.existsSync(BASE+'/pending-deployment.json'))throw Error('Deployment in progress');
 const current=JSON.parse(fs.readFileSync(BASE+'/current-deployment.json')),app=info(APP),gateway=info(GATEWAY);
 if(current.revision!==EXPECTED||health()?.revision!==EXPECTED||!app.State.Running)throw Error('Unexpected running version');
 const marker=BASE+'/workspace/deployment-maintenance.json',ack=BASE+'/workspace/deployment-drained.json';
 if(fs.existsSync(marker))throw Error('Maintenance already active');
 fs.mkdirSync(OUT,{recursive:true,mode:0o700});
 if(fs.readdirSync(OUT).length)throw Error('Backup destination is not empty');
 let stopped=false;const files=[];let before;
 fs.writeFileSync(marker,JSON.stringify({revision:EXPECTED,expiresAt:Date.now()+15*60_000}),{flag:'wx',mode:0o600});
 try{
  let drained=false;for(let i=0;i<100;i++){let a;try{a=JSON.parse(fs.readFileSync(ack));}catch{} if(a?.revision===EXPECTED&&inspect().active===0){drained=true;break;}await sleep(3000);}
  if(!drained)throw Error('Worker did not drain');
  before=inspect();if(before.integrity!=='ok'||before.active)throw Error('Workspace not ready');
  docker(['stop','--time','40',APP]);stopped=true;
  files.push(await encryptProcess('workspace.tar.gz','tar',['-C',BASE,'-cf','-','workspace','runtime.env','current-deployment.json','releases/'+EXPECTED]));
 }finally{
  if(stopped)docker(['start',APP]);
  for(const f of [marker,ack])if(fs.existsSync(f))fs.unlinkSync(f);
 }
 let ready=false;for(let i=0;i<60;i++){if(health()?.ready&&health()?.revision===EXPECTED){ready=true;break;}await sleep(2000);}
 if(!ready)throw Error('App health did not recover');
 const after=inspect();if(before.workspaceId!==after.workspaceId||after.integrity!=='ok'||JSON.stringify(before.counts)!==JSON.stringify(after.counts))throw Error('Workspace verification mismatch');
 files.push(await encryptProcess('docker-images.tar.gz','docker',['image','save',current.image,gateway.Config.Image]));
 if(info(APP).Image!==app.Image||info(GATEWAY).Image!==gateway.Image)throw Error('Images changed during backup');
 const receipt={id:ID,revision:EXPECTED,createdAt:new Date().toISOString(),appImage:current.image,appImageId:app.Image,gatewayImage:gateway.Config.Image,gatewayImageId:gateway.Image,workspace:before,files};
 fs.writeFileSync(OUT+'/receipt.json',JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({id:ID,revision:EXPECTED,files:files.map(f=>({file:f.file,bytes:f.bytes,sha256:f.sha256})),ready:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
