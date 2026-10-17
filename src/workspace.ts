import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { lstat, readlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';

const execute=promisify(execFile);
export type WorkspaceCheckpoint=Record<string,string>;

// Hashes stay in local state; no repository contents are sent to Spec for supervision.
export async function checkpoint(workspace:string):Promise<WorkspaceCheckpoint|undefined>{
  let names:string[];
  try{
    const result=await execute('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:workspace,windowsHide:true,maxBuffer:8_000_000});
    names=[...new Set(result.stdout.split('\0').filter(Boolean))].filter(path=>path!=='.specship'&&!path.startsWith('.specship/'));
  }catch{return undefined;} // Non-Git workspaces still require Spec's manual review.
  const result:WorkspaceCheckpoint=Object.create(null);
  for(const name of names.sort()){
    try{
      const path=join(workspace,name);const stat=await lstat(path);
      const hash=createHash('sha256');
      if(stat.isSymbolicLink())hash.update(await readlink(path));
      else if(stat.isFile())for await(const chunk of createReadStream(path))hash.update(chunk);
      else hash.update(`mode:${stat.mode}`);
      result[name]=hash.digest('hex');
    }catch(error:any){if(error.code!=='ENOENT')throw error;result[name]='missing';}
  }
  return result;
}

export function changedPaths(before:WorkspaceCheckpoint,after:WorkspaceCheckpoint):string[]{
  return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(path=>before[path]!==after[path]).sort();
}
