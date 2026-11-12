'use strict';
// Run from the project directory; reads secrets from ignored env files, never
// command-line arguments. Only an encrypted backup is uploaded to private R2.
const fs=require('node:fs'),path=require('node:path'),{randomBytes,randomUUID}=require('node:crypto');
async function main(){
 const [action,source,output]=process.argv.slice(2);
 if(action==='key'){
   const file=path.resolve(source||'.env.server');
   fs.writeFileSync(file,'RECIPE_INTELLIGENCE_SECRET_KEY='+randomBytes(32).toString('base64')+'\n',{flag:'wx',mode:0o600});
   console.log('Created the private server key file. Back it up securely; its contents are not displayed.');return;
 }
 require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
 if(fs.existsSync('.env.server'))process.loadEnvFile('.env.server');
 if(action!=='prepare'||!source||!output)throw Error('Usage: node scripts/migrate-recipe-intelligence-server.cjs key [private-env-file] OR prepare <source-folder> <new-backup-file>');
 const {prepareServerMigration}=require('../.intelligence-build/lib/recipe-intelligence/serverMigration.js');
 const {r2Config,R2Transport}=require('../.intelligence-build/lib/recipe-intelligence/r2.js');
 const config=r2Config();if(!config)throw Error('Private R2 storage must be configured.');
 const result=await prepareServerMigration(path.resolve(source),path.resolve(output));
 const cloud=new R2Transport(config),key=config.prefix+'/migrations/'+randomUUID()+'.ribak';
 const bytes=fs.readFileSync(result.file);
 await cloud.put(key,bytes,'application/octet-stream',result.sha256);
 const confirmed=await cloud.head(key);
 if(!confirmed||confirmed.sha256!==result.sha256||confirmed.size!==bytes.length)throw Error('Migration upload was not confirmed. Keep the local encrypted backup.');
 const receipt={objectKey:key,sha256:result.sha256,bytes:bytes.length,connections:result.connections,createdAt:new Date().toISOString()};
 fs.writeFileSync(result.file+'.json',JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(receipt));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
