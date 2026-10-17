import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { interruptCommand } from '../../dist/hooks.js';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'specship-hook-quoting-'));
  t.after(async()=>{
    const path=await realpath(root);
    assert.equal(dirname(path),await realpath(tmpdir()));
    assert.ok(basename(path).startsWith('specship-hook-quoting-'));
    await rm(path,{recursive:true,force:true});
  });
  const cli=join(root,"capture's & $cli.mjs");
  await writeFile(cli,'console.log(JSON.stringify(process.argv.slice(2)));\n');
  return {cli,workspace:join(root,"project's & $literal `literal` folder")};
}

test('macOS hook uses quoted POSIX arguments rather than the Windows launcher',()=>{
  const command=interruptCommand('/Applications/Codex App/node',"/Users/O'Reilly/specship/dist/cli.js",'/Users/test/my project','darwin');
  assert.ok(command.startsWith("'/Applications/Codex App/node' "));
  assert.ok(command.includes("O'\"'\"'Reilly"));
  assert.ok(command.endsWith("'interrupt' '--workspace' '/Users/test/my project'"));
  assert.doesNotMatch(command,/powershell|EncodedCommand/);
});

test('Windows hook preserves literal arguments through PowerShell', {skip:process.platform!=='win32'},async t=>{
  const {cli,workspace}=await fixture(t);
  const command=interruptCommand(process.execPath,cli,workspace,'win32');
  const [shell,...args]=command.split(' ');
  const result=spawnSync(shell,args,{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),['interrupt','--workspace',workspace]);
});

const posixShell=process.platform==='win32'?process.env.SPECSHIP_TEST_POSIX_SHELL:'/bin/sh';
test('POSIX hook preserves literal arguments through a shell', {skip:!posixShell},async t=>{
  const {cli,workspace}=await fixture(t);
  const posixPath=value=>process.platform==='win32'?value.replaceAll('\\','/'):value;
  const command=interruptCommand(posixPath(process.execPath),posixPath(cli),workspace,'darwin');
  const result=spawnSync(posixShell,['-c',command],{encoding:'utf8',windowsHide:true,env:{...process.env,MSYS2_ARG_CONV_EXCL:'*'}});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),['interrupt','--workspace',workspace]);
});
