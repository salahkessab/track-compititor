'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const BASE='/data/recipe-intelligence-trial',PROJECT='recipe-intelligence-trial';
const CONTAINER=PROJECT+'-app-1',WORKSPACE=BASE+'/workspace';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function revision(value){if(!/^[a-f0-9]{40}$/.test(value||''))throw Error('An exact commit SHA is required');return value;}
function atomicJson(file,value){fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);}
function run(command,args,{capture=false,env={}}={}){
 const result=spawnSync(command,args,{encoding:'utf8',stdio:capture?'pipe':'inherit',env:{...process.env,...env},maxBuffer:10*1024*1024});
 if(result.error||result.status!==0)throw Error(`${command} failed (${result.status ?? 'launch error'})`);
 return capture?result.stdout.trim():'';
}
function docker(args,options){return run('docker',args,options);}
function compose(descriptor,args){return docker(['compose','--env-file',BASE+'/runtime.env','-p',PROJECT,'-f',descriptor.compose,...args],{env:{RI_APP_IMAGE:descriptor.image}});}
function inspectImage(){return docker(['inspect','--format','{{.Image}}',CONTAINER],{capture:true});}
function imageFor(sha){return 'recipe-intelligence-app:'+revision(sha);}
function checkedEnvironment(){
 if(process.platform!=='linux'||process.env.GITHUB_REPOSITORY!=='salahkessab/track-compititor'||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Deploy only the private repository main branch on its Linux runner');
 const sha=revision(process.env.GITHUB_SHA);
 if(run('git',['rev-parse','HEAD'],{capture:true})!==sha)throw Error('Checkout does not match the deployment commit');
 if(!fs.existsSync(BASE+'/runtime.env')||fs.realpathSync(WORKSPACE)!==WORKSPACE)throw Error('Existing persistent workspace required');
 return sha;
}
function workspace(image,action,id){
 return JSON.parse(docker(['run','--rm','--network','none','--env-file',BASE+'/runtime.env','-e','RECIPE_INTELLIGENCE_ROOT=/var/lib/recipe-intelligence',
   '-v',WORKSPACE+':/var/lib/recipe-intelligence','--entrypoint','node',image,'scripts/deployment-workspace.cjs',action,...(id?[id]:[])],{capture:true}));
}
function preserved(before,after){
 assert.equal(after.integrity,'ok','Database integrity');assert.equal(after.workspaceId,before.workspaceId,'Workspace identity');
 for(const [table,count] of Object.entries(before.counts))assert.equal(after.counts[table],count,`Stored ${table} changed during deployment`);
}
async function health(){
 try{return JSON.parse(docker(['exec',CONTAINER,'node','-e',"fetch('http://127.0.0.1:3000/api/server-health').then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()));}).catch(()=>process.exit(1));"],{capture:true}));}
 catch{return null;}
}
async function ready(expected,deadline){
 while(Date.now()<deadline){const state=await health();if(state?.ready&&(!expected||state.revision===expected))return state;await sleep(2000);}
 throw Error('Updated web/worker did not become healthy');
}
async function verify(sha){
 const image=imageFor(sha);console.log('Building commit '+sha);
 // This dedicated runner retains tagged releases for rollback. BuildKit's
 // unused cache is disposable and can fill the root disk between releases.
 const disk=fs.statfsSync('/var/lib/docker');
 if(disk.bavail*disk.bsize<3*1024**3){
   console.log('Low Docker disk space; releasing unused build cache before verification.');
   docker(['builder','prune','--all','--force']);
 }
 docker(['build','--build-arg','APP_REVISION='+sha,'--tag',image,'.']);
 // No host mounts, provider environment, cache/artifact billing, or network.
 docker(['run','--rm','--network','none','--memory','4g','--cpus','2','--user','0','-e','NODE_ENV=test','--entrypoint','sh',image,'-c','npm test && npx tsc --noEmit && node scripts/smoke-recipe-intelligence-server.cjs']);
 atomicJson(BASE+'/verified-'+sha+'.json',{revision:sha,image,verifiedAt:new Date().toISOString()});
}
async function release(sha){
 const image=imageFor(sha),verified=JSON.parse(fs.readFileSync(BASE+'/verified-'+sha+'.json'));
 if(verified.revision!==sha||verified.image!==image)throw Error('Run verification for this commit first');
 const embedded=docker(['image','inspect','--format','{{index .Config.Labels "org.opencontainers.image.revision"}}',image],{capture:true});
 if(embedded!==sha)throw Error('Image revision mismatch');
 const currentFile=BASE+'/current-deployment.json',pendingFile=BASE+'/pending-deployment.json';
 if(fs.existsSync(pendingFile))throw Error('A previous deployment was interrupted. Inspect pending-deployment.json before another update; no database will be overwritten.');
 const current=fs.existsSync(currentFile)?JSON.parse(fs.readFileSync(currentFile)):{compose:BASE+'/source/deploy/instabox/compose.yaml',image:inspectImage(),revision:null};
 if(current.revision===sha&&(await health())?.revision===sha){console.log('This commit is already running.');return;}
 const folder=BASE+'/releases/'+sha,composeFile=folder+'/deploy/instabox/compose.yaml';fs.mkdirSync(path.dirname(composeFile),{recursive:true});
 for(const filename of ['compose.yaml','Caddyfile'])fs.copyFileSync(path.join('deploy/instabox',filename),path.join(path.dirname(composeFile),filename));
 const candidate={revision:sha,image,compose:composeFile};
 const marker=path.join(WORKSPACE,'deployment-maintenance.json'),ack=path.join(WORKSPACE,'deployment-drained.json');
 const backupId='deploy-'+sha+'-'+Date.now(),expiresAt=Date.now()+20*60_000;
 const oldHealth=await ready(null,Date.now()+60_000),before=workspace(image,'inspect');
 // The initial trial predates draining; bootstrap only with no paid history.
 if(!oldHealth.deploymentProtocol&&(before.counts.api_calls||before.active))throw Error('Legacy workspace is busy; install the drain-capable release before enabling paid work');
 const pending={revision:sha,previous:current,candidate,backupId,expiresAt,before,phase:'draining'};
 atomicJson(pendingFile,pending);atomicJson(marker,{revision:sha,expiresAt});
 let stopped=false,backedUp=false,installed=false,complete=false;
 const deadline=()=>{if(Date.now()>=expiresAt)throw Error('Deployment maintenance window expired; retained data requires inspection');};
 try {
   if(oldHealth.deploymentProtocol){
     let drained=false;
     while(Date.now()<expiresAt-180_000){
       let acknowledgement;try{acknowledgement=JSON.parse(fs.readFileSync(ack));}catch{}
       if(acknowledgement?.revision===sha&&workspace(image,'inspect').active===0){drained=true;break;}await sleep(3000);
     }
     if(!drained)throw Error('Existing work is still active; update postponed');
   }
   deadline();compose(current,['stop','app']);stopped=true;
   const receipt=workspace(image,'backup',backupId);backedUp=true;pending.before=receipt;pending.phase='backed-up';atomicJson(pendingFile,pending);
   deadline();installed=true;pending.phase='installing';atomicJson(pendingFile,pending);
   compose(candidate,['up','-d','--no-build']);await ready(sha,Math.min(expiresAt,Date.now()+120_000));deadline();
   preserved(receipt,workspace(image,'inspect'));
   atomicJson(currentFile,{...candidate,previous:current,backupId,deployedAt:new Date().toISOString()});
   complete=true;fs.unlinkSync(pendingFile);console.log('Deployed '+sha+'; encrypted backup saved; workspace preserved.');
   if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Deployed commit \`${sha}\` to InstaBox. Tests passed, encrypted database backup saved, and workspace counts preserved.\n`);
 }catch(error){
   if(complete)throw error;
   if(stopped&&Date.now()<expiresAt){
     console.log('Update failed; restoring the preceding app release.');
     try{
       if(installed)compose(candidate,['stop','app']);
       if(backedUp)workspace(image,'restore',backupId);
       compose(current,['up','-d','--no-build']);await ready(current.revision,Date.now()+120_000);
       fs.unlinkSync(pendingFile);console.log('Previous release restored.');
     }catch{console.error('Automatic recovery needs attention; encrypted backup and deployment record retained.');}
   }else if(!stopped&&fs.existsSync(pendingFile))fs.unlinkSync(pendingFile);
   throw error;
 }finally{
   if(complete||!fs.existsSync(pendingFile))for(const file of [marker,ack])if(fs.existsSync(file))fs.unlinkSync(file);
 }
}
module.exports={revision,preserved,imageFor};
if(require.main===module)(async()=>{const sha=checkedEnvironment();if(process.argv[2]==='verify')await verify(sha);else if(process.argv[2]==='release')await release(sha);else throw Error('Use verify or release');})().catch(error=>{console.error(error.message);process.exitCode=1;});
