import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { Artifact } from './contracts.js';
import { preparePrivateStorage, privateDirectory } from './private-storage.js';

export const MAX_ARTIFACT_BYTES = 5_000_000; // Leaves room for base64 and JSON framing under the 8 MB callback response cap.
const signatures: Record<string, (bytes:Buffer)=>boolean> = {
  'image/png': bytes=>bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
  'image/jpeg': bytes=>bytes[0]===255&&bytes[1]===216,
};
function checkBytes(mime:string,bytes:Buffer):void{
  if(!signatures[mime])throw new Error(`Unsupported artifact MIME type ${mime}; verified support is PNG and JPEG only`);
  if(bytes.length>MAX_ARTIFACT_BYTES)throw new Error(`Artifact exceeds supported ${MAX_ARTIFACT_BYTES}-byte image limit; resize is not performed`);
  if(!signatures[mime](bytes))throw new Error('Image artifact bytes do not match the declared MIME type');
}
async function safeWorkspacePath(root:string,path:string):Promise<string>{
  const workspace=await realpath(root);const location=resolve(workspace,path);const link=await lstat(location);if(link.isSymbolicLink())throw new Error('Artifact input may not be a symbolic link');const canonical=await realpath(location);const rel=relative(workspace,canonical);if(rel==='..'||rel.startsWith(`..${sep}`)||resolve(workspace,rel)!==canonical)throw new Error('Artifact must resolve inside the workspace');return canonical;
}
export async function verifyArtifact(root:string,input:unknown):Promise<{reference:ReturnType<typeof Artifact.parse>;bytes:Buffer}>{
  const reference=Artifact.parse(input);const canonical=await safeWorkspacePath(root,reference.path);const bytes=await readFile(canonical);
  if(bytes.length!==reference.size||createHash('sha256').update(bytes).digest('hex')!==reference.sha256)throw new Error(`Artifact integrity check failed: ${reference.id}`);
  checkBytes(reference.mime,bytes);return {reference,bytes};
}
export async function materializeArtifacts(root:string,inputs:unknown[]=[]):Promise<Array<ReturnType<typeof Artifact.parse>>>{
  const workspace=await realpath(root);await preparePrivateStorage(workspace);const directory=resolve(workspace,'.specship','artifacts');await privateDirectory(directory);const output=[];let aggregate=0;
  if((await lstat(directory)).isSymbolicLink()||await realpath(directory)!==directory)throw new Error('Artifact store must be a real directory inside the workspace');
  for(const input of inputs){
    const value=input as any;let bytes:Buffer;let source:string;
    if(typeof value?.mime==='string'&&!signatures[value.mime])throw new Error(`Unsupported artifact MIME type ${value.mime}; verified media is PNG/JPEG up to ${MAX_ARTIFACT_BYTES} bytes`);
    if(value&&typeof value==='object'&&'sha256'in value){const parsed=Artifact.parse(value);source=await safeWorkspacePath(workspace,parsed.path);bytes=await readFile(source);if(bytes.length!==parsed.size||createHash('sha256').update(bytes).digest('hex')!==parsed.sha256)throw new Error(`Supplied artifact hash/size mismatch: ${parsed.id}`);checkBytes(parsed.mime,bytes);}
    else{if(!value||typeof value.path!=='string'||typeof value.mime!=='string'||typeof value.purpose!=='string')throw new Error('Artifact input needs a resolvable local path, MIME type, and purpose');source=await safeWorkspacePath(workspace,value.path);bytes=await readFile(source);checkBytes(value.mime,bytes);}
    aggregate+=bytes.length;if(aggregate>MAX_ARTIFACT_BYTES)throw new Error(`Combined activity images exceed supported ${MAX_ARTIFACT_BYTES}-byte limit`);
    const mime=value.mime as string;checkBytes(mime,bytes);const sha256=createHash('sha256').update(bytes).digest('hex');
    if(value.sha256&&value.sha256!==sha256)throw new Error('Supplied artifact SHA-256 does not match source bytes');
    if(value.size!==undefined&&value.size!==bytes.length)throw new Error('Supplied artifact size does not match source bytes');
    const extension=mime==='image/png'?'.png':'.jpg';const rel=`.specship/artifacts/${sha256}${extension}`;const destination=resolve(workspace,rel);
    try{const stat=await lstat(destination);if(stat.isSymbolicLink())throw new Error('Canonical artifact path may not be a symbolic link');const canonical=await realpath(destination);if(!canonical.startsWith(`${directory}${sep}`))throw new Error('Canonical artifact escaped the artifact store');const existing=await readFile(canonical);if(!existing.equals(bytes))throw new Error('Content-addressed artifact collision or mutation');}
    catch(error:any){if(error.code!=='ENOENT')throw error;const temp=resolve(directory,`${sha256}.${randomUUID()}.tmp`);await writeFile(temp,bytes,{flag:'wx',mode:0o600});await rename(temp,destination);}
    output.push(Artifact.parse({id:value.id??sha256,mime,path:rel,sha256,size:bytes.length,purpose:value.purpose}));
  }
  if(new Set(output.map(item=>item.id)).size!==output.length)throw new Error('Artifact IDs must be unique within an activity');
  return output;
}
