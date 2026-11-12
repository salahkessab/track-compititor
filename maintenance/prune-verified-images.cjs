'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const BASE='/data/recipe-intelligence-trial',APP='recipe-intelligence-trial-app-1';
const run=(c,a)=>execFileSync(c,a,{encoding:'utf8',maxBuffer:8*1024*1024}).trim();
const docker=a=>run('docker',a);
async function hash(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
function health(){return JSON.parse(docker(['exec',APP,'node','-e',"fetch('http://127.0.0.1:3000/api/server-health').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))"]));}
function inspect(){return JSON.parse(docker(['exec',APP,'node','scripts/deployment-workspace.cjs','inspect']));}
(async()=>{
 if(process.platform!=='linux'||process.env.GITHUB_REPOSITORY!=='salahkessab/track-compititor'||process.env.GITHUB_REF!=='refs/heads/codex/instabox-backup')throw Error('Wrong cleanup environment');
 const verification=JSON.parse(fs.readFileSync('maintenance/verified-backup.json'));
 if(verification.databaseIntegrity!=='ok'||!verification.imageManifestsVerified)throw Error('Local backup not verified');
 const folder=BASE+'/offline-backups/pc-backup-20261112',receipt=JSON.parse(fs.readFileSync(folder+'/receipt.json'));
 if(await hash(folder+'/receipt.json')!==verification.receiptSha256)throw Error('Backup receipt mismatch');
 for(const f of receipt.files)if(await hash(folder+'/'+f.file)!==f.sha256)throw Error('Backup archive checksum mismatch');
 const current=JSON.parse(fs.readFileSync(BASE+'/current-deployment.json'));
 if(current.revision!==verification.revision||receipt.revision!==current.revision||!health().ready||health().revision!==current.revision)throw Error('Running app mismatch');
 if(fs.existsSync(BASE+'/pending-deployment.json')||fs.existsSync(BASE+'/workspace/deployment-maintenance.json'))throw Error('Deployment active');
 const before=inspect();if(before.integrity!=='ok')throw Error('Workspace integrity failed');
 const containers=docker(['ps','-aq']).split(/\s+/).filter(Boolean);
 const protectedIds=new Set(JSON.parse(docker(['inspect',...containers])).map(c=>c.Image));protectedIds.add(receipt.appImageId);protectedIds.add(receipt.gatewayImageId);
 const removed=[];
 for(const repo of ['recipe-intelligence-app','recipe-intelligence-trial-app']){
  const lines=docker(['image','ls','--format','{{json .}}',repo]).split('\n').filter(Boolean);
  for(const line of lines){const entry=JSON.parse(line);if(entry.Repository!==repo||entry.Tag==='<none>')continue;const tag=entry.Repository+':'+entry.Tag;const id=docker(['image','inspect','--format','{{.Id}}',tag]);if(protectedIds.has(id))continue;
   docker(['image','rm',tag]);removed.push(tag);
  }
 }
 const cache=docker(['builder','prune','--all','--force']);
 const after=inspect();if(!health().ready||health().revision!==receipt.revision||after.integrity!=='ok'||before.workspaceId!==after.workspaceId||JSON.stringify(before.counts)!==JSON.stringify(after.counts))throw Error('Post-cleanup verification failed');
 const report={revision:receipt.revision,backupVerifiedOnPC:true,removed,cache,workspacePreserved:true,ready:true,disk:run('df',['-h','/','/data']),remainingImages:docker(['image','ls','recipe-intelligence-app'])};
 fs.writeFileSync(folder+'/cleanup-receipt.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
