'use strict';
// Runs in the app image with the existing server environment. No credentials
// leave the server. Backup/restore are used only while the app is stopped.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {sealDatabase,unsealDatabase}=require('../.intelligence-build/lib/recipe-intelligence/serverMigration.js');
function rootPath(root){const resolved=path.resolve(root);if(!root||resolved===path.parse(resolved).root)throw Error('Invalid workspace');return resolved;}
function backupFile(root,id){if(!/^deploy-[a-f0-9]{40}-\d{13}$/.test(id))throw Error('Invalid deployment backup ID');return path.join(root,'backups',id+'.ribak');}
function inspect(root){
 const db=new Database(path.join(rootPath(root),'database/recipe-intelligence.sqlite'),{readonly:true,fileMustExist:true});
 try {
   const counts={};for(const t of ['content_batches','content_items','api_calls','artifacts','recipe_imports','tracked_sites','recipe_records','reference_photos','wordpress_exports','wordpress_media'])counts[t]=db.prepare('SELECT count(*) n FROM '+t).get().n;
   const active=db.prepare("SELECT count(*) n FROM content_stages WHERE state='running'").get().n+db.prepare("SELECT count(*) n FROM wordpress_exports WHERE state='sending'").get().n+db.prepare("SELECT count(*) n FROM wordpress_media WHERE state='uploading'").get().n;
   return {counts,active,workspaceId:db.prepare("SELECT value FROM settings WHERE key='workspace_id'").get()?.value,integrity:db.pragma('integrity_check',{simple:true})};
 }finally{db.close();}
}
async function backup(root,id){
 root=rootPath(root);const before=inspect(root);if(before.active||before.integrity!=='ok')throw Error('Workspace is not ready for backup');
 const target=backupFile(root,id);fs.mkdirSync(path.dirname(target),{recursive:true});const temporary=target+'.sqlite';
 const db=new Database(path.join(root,'database/recipe-intelligence.sqlite'),{readonly:true,fileMustExist:true});
 try {await db.backup(temporary);const bytes=sealDatabase(fs.readFileSync(temporary));fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});const receipt={...before,backup:id,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};fs.writeFileSync(target+'.json',JSON.stringify(receipt),{flag:'wx',mode:0o600});return receipt;}
 finally{db.close();if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function restore(root,id){
 root=rootPath(root);const file=backupFile(root,id),receipt=JSON.parse(fs.readFileSync(file+'.json'));
 const sealed=fs.readFileSync(file);if(crypto.createHash('sha256').update(sealed).digest('hex')!==receipt.sha256)throw Error('Backup checksum mismatch');
 const bytes=unsealDatabase(sealed),target=path.join(root,'database/recipe-intelligence.sqlite'),temporary=target+'.restore';
 fs.writeFileSync(temporary,bytes,{mode:0o600});const db=new Database(temporary,{readonly:true});try{if(db.pragma('integrity_check',{simple:true})!=='ok')throw Error('Backup integrity failure');}finally{db.close();}
 for(const suffix of ['-wal','-shm'])if(fs.existsSync(target+suffix))fs.unlinkSync(target+suffix);
 fs.renameSync(temporary,target);return inspect(root);
}
module.exports={inspect,backup,restore,backupFile};
if(require.main===module)(async()=>{const [action,id]=process.argv.slice(2),root=process.env.RECIPE_INTELLIGENCE_ROOT;const result=action==='inspect'?inspect(root):action==='backup'?await backup(root,id):action==='restore'?restore(root,id):(()=>{throw Error('Unknown action');})();console.log(JSON.stringify(result));})().catch(()=>{console.error('Deployment workspace operation failed; saved data was not published.');process.exitCode=1;});
