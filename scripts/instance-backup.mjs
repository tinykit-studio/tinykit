#!/usr/bin/env node
// Run on the Tinykit server. Backups include account credentials and uploads;
// they belong in a private destination, outside the web root.
import PocketBase from 'pocketbase';
import { readFile, mkdir, open, rename, rm, realpath, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

export async function backupClient(env = process.env) {
  const url = new URL(env.POCKETBASE_URL || 'http://127.0.0.1:8091');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) throw Error('Backups require HTTPS or a loopback PocketBase server.');
  const pb = new PocketBase(url.origin); pb.autoCancellation(false);
  let setup = {};
  try { setup = JSON.parse(await readFile(env.TINYKIT_SETUP_FILE || './pocketbase/pb_data/.setup_complete','utf8')); } catch(error) { if(error.code!=='ENOENT') throw error; }
  const email = env.POCKETBASE_ADMIN_EMAIL || setup.admin_email;
  const password = env.POCKETBASE_ADMIN_PASSWORD || setup.admin_password;
  if(email && password) await pb.collection('_superusers').authWithPassword(email,password);
  else if(setup.auth_token) { pb.authStore.save(setup.auth_token,null); await pb.collection('_superusers').authRefresh(); }
  else throw Error('Run this on the Tinykit server with its existing setup file or PocketBase administrator environment.');
  return pb;
}

export async function createBackup(pb, directory) {
  let root = resolve(directory);
  await mkdir(root,{recursive:true,mode:0o700});
  if((await lstat(root)).isSymbolicLink()) throw Error('The backup destination must not be a symbolic link.');
  root = await realpath(root);
  const name = `tinykit_${Date.now()}_${randomUUID().slice(0,8)}.zip`;
  await pb.backups.create(name);
  // PocketBase creates snapshots asynchronously. Do not report success before
  // the snapshot exists and the entire archive has reached the destination.
  let found;
  for(let attempt=0;attempt<600;attempt++) {
    found=(await pb.backups.getFullList()).find(file=>file.key===name);
    if(found?.size>0)break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!found?.size) throw Error('Snapshot did not finish within five minutes. Check PocketBase before retrying.');
  const token=await pb.files.getToken();
  const response=await fetch(pb.backups.getDownloadURL(token,name),{redirect:'error',signal:AbortSignal.timeout(300000)});
  if(!response.ok||!response.body)throw Error('Could not download the snapshot.');
  const path=join(root,name),partial=path+'.partial';
  const file=await open(partial,'wx',0o600),hash=createHash('sha256');let bytes=0;
  try {
    const digest=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;hash.update(chunk);done(null,chunk)}});
    await pipeline(Readable.fromWeb(response.body),digest,file.createWriteStream());
    if(bytes!==found.size)throw Error('Snapshot download was incomplete.');
    await rename(partial,path);
    const checksum=hash.digest('hex');
    const manifest=await open(path+'.sha256','wx',0o600);
    try{await manifest.writeFile(`${checksum}  ${name}\n`)}finally{await manifest.close()}
    return {ok:true,file:path,bytes,sha256:checksum,message:`Backup saved: ${path}`};
  } catch(error) {await file.close().catch(()=>{});await rm(partial,{force:true});throw error}
}

export async function scheduleBackups(pb,{cron='0 8 * * *',keep=14}={}) {
  if(!Number.isInteger(keep)||keep<2||keep>365)throw Error('Keep between 2 and 365 daily backups.');
  const settings=await pb.settings.getAll();
  // Only update backup options; preserve existing S3 settings and all other
  // instance settings. PocketBase validates the cron expression.
  await pb.settings.update({backups:{...settings.backups,cron,cronMaxKeep:keep}});
  const saved=await pb.settings.getAll();
  if(saved.backups.cron!==cron||saved.backups.cronMaxKeep!==keep)throw Error('Backup schedule was not saved.');
  return {ok:true,cron,keep,message:`Automatic backups configured: ${cron}; keep ${keep}. PocketBase uses the server timezone.`};
}

async function main(args) {
  const [command,destination,...extra]=args;
  if(command==='create'&&destination&&!extra.length) return createBackup(await backupClient(),destination);
  if(command==='schedule'&&!destination) return scheduleBackups(await backupClient());
  throw Error('Usage: node scripts/instance-backup.mjs create <private-backup-directory> | schedule\nSchedule defaults to 08:00 server time daily, retaining 14 snapshots.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{console.log(JSON.stringify(await main(process.argv.slice(2)),null,2))}catch(error){console.error(error.message);process.exitCode=1}
}
